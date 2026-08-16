#include <libgen.h>
#include <limits.h>
#include <mach-o/dyld.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int main(void) {
    char executable[PATH_MAX];
    uint32_t size = sizeof(executable);
    if (_NSGetExecutablePath(executable, &size) != 0) {
        return 126;
    }

    char resolved[PATH_MAX];
    if (realpath(executable, resolved) == NULL) {
        return 126;
    }

    char directory_buffer[PATH_MAX];
    if (snprintf(directory_buffer, sizeof(directory_buffer), "%s", resolved) >= (int)sizeof(directory_buffer)) {
        return 126;
    }

    char script[PATH_MAX];
    if (snprintf(script, sizeof(script), "%s/InstaLibraryLauncher", dirname(directory_buffer)) >= (int)sizeof(script)) {
        return 126;
    }

    execl("/bin/zsh", "zsh", script, (char *)NULL);
    return 127;
}
