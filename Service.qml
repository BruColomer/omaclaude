import QtQuick
import Quickshell.Io

// omaclaude service plugin.
//
// The stylesheet is produced by the theme-set hook that install.sh puts in
// place, so nothing happens here per theme switch. This component only runs
// the (idempotent, user-level) installer once when the shell starts, which
// keeps the hook and the injector files current after a plugin update.
//
// The app itself is patched by root/setup.sh, which needs sudo and is never
// run from here. install.sh only prints a reminder when that step is missing.
Item {
    id: root

    // Supplied by the shell's plugin loader.
    property var shell: null
    property var manifest: null

    readonly property string pluginDir: {
        if (manifest && manifest.__sourceDir)
            return String(manifest.__sourceDir)
        var here = String(Qt.resolvedUrl("."))
        if (here.startsWith("file://"))
            here = here.substring(7)
        if (here.endsWith("/"))
            here = here.slice(0, -1)
        return decodeURIComponent(here)
    }

    property string lastError: ""

    Process {
        id: installer

        command: ["bash", root.pluginDir + "/install.sh", "--quiet"]

        stderr: StdioCollector {
            waitForEnd: true
            onStreamFinished: {
                var message = String(text || "").trim()
                if (message.length > 0)
                    root.lastError = message.length > 400 ? message.slice(-400) : message
            }
        }

        onExited: function (exitCode) {
            if (exitCode !== 0)
                console.warn("omaclaude: installer exited " + exitCode
                             + (root.lastError.length > 0 ? ": " + root.lastError : ""))
        }
    }

    // Give the shell a moment to finish starting before touching any config.
    Timer {
        interval: 2000
        running: true
        repeat: false
        onTriggered: {
            if (!installer.running) {
                root.lastError = ""
                installer.running = true
            }
        }
    }
}
