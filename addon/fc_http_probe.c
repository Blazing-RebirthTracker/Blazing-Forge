/*
 * BlazingForge iOS v0.5.1: opt-in-scope (box endpoint only) loopback HTTP
 * diagnostic. Data is recorded locally; this code never modifies network
 * requests, responses, unit tables, saves, or backend validation.
 *
 * DYLD_INTERPOSE is intentionally used instead of rebinding arbitrary client
 * functions. If iOS does not honor interposition, there will simply be no log.
 */
#include <sys/socket.h>
#include <sys/uio.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <fcntl.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include <errno.h>
#include <dlfcn.h>
#include <sys/stat.h>
#include <time.h>

#define TRACK_LIMIT 8192
#define SAMPLES_PER_FD 24
static __thread int probe_busy = 0;
static unsigned char tracked[TRACK_LIMIT];
static unsigned short samples[TRACK_LIMIT];

static int is_port18080(int fd) {
    struct sockaddr_storage a;
    socklen_t n = sizeof a;
    if (getsockname(fd, (struct sockaddr *)&a, &n) == 0) {
        if (a.ss_family == AF_INET && ntohs(((struct sockaddr_in *)&a)->sin_port) == 18080) return 1;
        if (a.ss_family == AF_INET6 && ntohs(((struct sockaddr_in6 *)&a)->sin6_port) == 18080) return 1;
    }
    n = sizeof a;
    if (getpeername(fd, (struct sockaddr *)&a, &n) == 0) {
        if (a.ss_family == AF_INET && ntohs(((struct sockaddr_in *)&a)->sin_port) == 18080) return 1;
        if (a.ss_family == AF_INET6 && ntohs(((struct sockaddr_in6 *)&a)->sin6_port) == 18080) return 1;
    }
    return 0;
}
static int contains(const unsigned char *p, size_t n, const char *needle) {
    size_t m = strlen(needle);
    if (m > n) return 0;
    for (size_t i = 0; i + m <= n; i++)
        if (!memcmp(p+i, needle, m)) return 1;
    return 0;
}
static void record_sample(const char *operation, int fd, const void *raw, ssize_t len) {
    if (probe_busy || fd < 0 || fd >= TRACK_LIMIT || !raw || len <= 0) return;
    const unsigned char *p = (const unsigned char *)raw;
    size_t n = (size_t)len;
    size_t scan = n > 65536 ? 65536 : n;
    int endpoint = contains(p, scan, "/api/box/list.json") ||
                   contains(p, scan, "/api/box/get.json");
    if (!endpoint && !tracked[fd]) return;
    if (!is_port18080(fd)) return;
    probe_busy = 1;
    if (endpoint) { tracked[fd] = 1; samples[fd] = 0; }
    unsigned count = samples[fd]++;
    if (count >= SAMPLES_PER_FD) { probe_busy = 0; return; }

    /* Sample is limited and printable; no changes to actual network traffic. */
    char line[1700], preview[1150];
    size_t limit = n < 1100 ? n : 1100;
    for (size_t i = 0; i < limit; i++) {
        unsigned char c = p[i];
        preview[i] = c == '\r' ? '|' : c == '\n' ? '~' :
                     (c >= 32 && c <= 126) ? (char)c : '.';
    }
    preview[limit] = 0;
    time_t now = time(NULL);
    snprintf(line, sizeof line, "[%lld] %s fd=%d bytes=%zd sample=%u %s\n",
             (long long)now, operation, fd, len, count, preview);
    const char *home = getenv("HOME");
    if (home && strlen(home) < 600) {
        char dir[900], path[1024];
        snprintf(dir, sizeof dir, "%s/Documents/BlazingForge", home);
        mkdir(dir, 0755);
        snprintf(path, sizeof path, "%s/box-http-v0.5.1.log", dir);
        int logfd = open(path, O_WRONLY | O_CREAT | O_APPEND, 0600);
        if (logfd >= 0) {
            (void)write(logfd, line, strlen(line));
            close(logfd);
        }
    }
    probe_busy = 0;
}

static ssize_t (*real_send)(int,const void *,size_t,int);
static ssize_t (*real_recv)(int,void *,size_t,int);
static ssize_t (*real_write)(int,const void *,size_t);
static ssize_t (*real_read)(int,void *,size_t);
static ssize_t (*real_writev)(int,const struct iovec *,int);
static ssize_t (*real_sendmsg)(int,const struct msghdr *,int);

static ssize_t diagnostic_send(int fd,const void *p,size_t n,int flags) {
    if (!real_send) real_send = dlsym(RTLD_NEXT,"send");
    if (!real_send) { errno = ENOSYS; return -1; }
    ssize_t r = real_send(fd,p,n,flags); int saved = errno;
    if (r > 0) record_sample("send",fd,p,r);
    errno = saved; return r;
}
static ssize_t diagnostic_recv(int fd,void *p,size_t n,int flags) {
    if (!real_recv) real_recv = dlsym(RTLD_NEXT,"recv");
    if (!real_recv) { errno = ENOSYS; return -1; }
    ssize_t r = real_recv(fd,p,n,flags); int saved = errno;
    if (r > 0) record_sample("recv",fd,p,r);
    errno = saved; return r;
}
static ssize_t diagnostic_write(int fd,const void *p,size_t n) {
    if (!real_write) real_write = dlsym(RTLD_NEXT,"write");
    if (!real_write) { errno = ENOSYS; return -1; }
    ssize_t r = real_write(fd,p,n); int saved = errno;
    if (r > 0) record_sample("write",fd,p,r);
    errno = saved; return r;
}
static ssize_t diagnostic_read(int fd,void *p,size_t n) {
    if (!real_read) real_read = dlsym(RTLD_NEXT,"read");
    if (!real_read) { errno = ENOSYS; return -1; }
    ssize_t r = real_read(fd,p,n); int saved = errno;
    if (r > 0) record_sample("read",fd,p,r);
    errno = saved; return r;
}
static ssize_t diagnostic_writev(int fd,const struct iovec *v,int count) {
    if (!real_writev) real_writev = dlsym(RTLD_NEXT,"writev");
    if (!real_writev) { errno = ENOSYS; return -1; }
    ssize_t r = real_writev(fd,v,count); int saved = errno;
    if (r > 0 && count > 0 && v[0].iov_base)
        record_sample("writev",fd,v[0].iov_base,(ssize_t)v[0].iov_len);
    errno = saved; return r;
}
static ssize_t diagnostic_sendmsg(int fd,const struct msghdr *msg,int flags) {
    if (!real_sendmsg) real_sendmsg = dlsym(RTLD_NEXT,"sendmsg");
    if (!real_sendmsg) { errno = ENOSYS; return -1; }
    ssize_t r = real_sendmsg(fd,msg,flags); int saved = errno;
    if (r > 0 && msg && msg->msg_iovlen > 0 && msg->msg_iov[0].iov_base)
        record_sample("sendmsg",fd,msg->msg_iov[0].iov_base,(ssize_t)msg->msg_iov[0].iov_len);
    errno = saved; return r;
}
#define INTERPOSE(replacement, replacee) \
 __attribute__((used,section("__DATA,__interpose"))) \
 static const struct {const void *newfn;const void *oldfn;} \
 interpose_##replacee = {(const void *)(replacement),(const void *)(replacee)};
INTERPOSE(diagnostic_send, send)
INTERPOSE(diagnostic_recv, recv)
INTERPOSE(diagnostic_write, write)
INTERPOSE(diagnostic_read, read)
INTERPOSE(diagnostic_writev, writev)
INTERPOSE(diagnostic_sendmsg, sendmsg)
