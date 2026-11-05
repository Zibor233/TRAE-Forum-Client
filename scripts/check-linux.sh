#!/bin/sh
# Read-only diagnostic for Kylin V10 and other Linux desktops.
set -u
printf '\n== System ==\n'
uname -sm
if [ -r /etc/os-release ]; then cat /etc/os-release; fi
printf '\n== C library ==\n'
getconf GNU_LIBC_VERSION 2>/dev/null || true
printf '\n== Desktop ==\n'
printf 'Session: %s / %s\n' "${XDG_SESSION_TYPE:-unknown}" "${XDG_CURRENT_DESKTOP:-unknown}"
printf '\n== User namespace sandbox ==\n'
for key in kernel.unprivileged_userns_clone user.max_user_namespaces kernel.apparmor_restrict_unprivileged_userns; do
  sysctl "$key" 2>/dev/null || true
done
if [ "$#" -gt 0 ]; then
  printf '\n== Runtime dependencies ==\n'
  if [ -f "$1" ]; then
    file "$1"
    ldd "$1" 2>&1 || true
  else
    printf 'Executable does not exist: %s\n' "$1"
    exit 1
  fi
else
  printf '\nTo check missing libraries, rerun with the extracted trae-forum-client executable path.\n'
fi
