const Main = imports.ui.main;
const Meta = imports.gi.Meta;
const Util = imports.misc.util;
const Gio = imports.gi.Gio;

let settingsChangedId = null;
let originalBinding = null;
const SETTINGS_SCHEMA = 'org.cinnamon.desktop.keybindings.wm';
const SETTINGS_KEY = 'close';

function init(metadata) {
    global.log('[Alt-F4 Power Menu] ===== INIT CALLED =====');
}

function enable() {
    global.log('[Alt-F4 Power Menu] ===== ENABLE CALLED =====');
    
    try {
        // Save the original Alt+F4 binding
        let settings = new Gio.Settings({ schema_id: SETTINGS_SCHEMA });
        originalBinding = settings.get_strv(SETTINGS_KEY);
        global.log('[Alt-F4 Power Menu] Original binding: ' + JSON.stringify(originalBinding));
        
        // Clear the window manager's Alt+F4 binding temporarily
        settings.set_strv(SETTINGS_KEY, []);
        global.log('[Alt-F4 Power Menu] Cleared WM binding');
        
        // Now register our own Alt+F4 handler
        Main.keybindingManager.addHotKey(
            'alt-f4-custom',
            '<Alt>F4',
            function() {
                global.log('[Alt-F4 Power Menu] ===== HOTKEY TRIGGERED =====');
                
                let focusWindow = global.display.focus_window;
                global.log('[Alt-F4 Power Menu] Focus window: ' + focusWindow);
                
                if (focusWindow) {
                    global.log('[Alt-F4 Power Menu] Window type: ' + focusWindow.window_type);
                    global.log('[Alt-F4 Power Menu] Window type is NORMAL: ' + (focusWindow.window_type === Meta.WindowType.NORMAL));
                }
                
                let hasNormalWindow = focusWindow && focusWindow.window_type === Meta.WindowType.NORMAL;
                
                if (hasNormalWindow) {
                    global.log('[Alt-F4 Power Menu] Closing window');
                    focusWindow.delete(global.get_current_time());
                } else {
                    global.log('[Alt-F4 Power Menu] Opening power menu');
                    Util.spawn(['cinnamon-session-quit', '--power-off']);
                }
            }
        );
        
        global.log('[Alt-F4 Power Menu] ===== ENABLED SUCCESSFULLY =====');
    } catch(e) {
        global.logError('[Alt-F4 Power Menu] Error in enable(): ' + e + '\n' + e.stack);
    }
}

function disable() {
    global.log('[Alt-F4 Power Menu] ===== DISABLE CALLED =====');
    
    try {
        // Remove our hotkey
        Main.keybindingManager.removeHotKey('alt-f4-custom');
        global.log('[Alt-F4 Power Menu] Removed custom hotkey');
        
        // Restore the original window manager binding
        if (originalBinding) {
            let settings = new Gio.Settings({ schema_id: SETTINGS_SCHEMA });
            settings.set_strv(SETTINGS_KEY, originalBinding);
            global.log('[Alt-F4 Power Menu] Restored original binding: ' + JSON.stringify(originalBinding));
        }
    } catch(e) {
        global.logError('[Alt-F4 Power Menu] Error in disable(): ' + e);
    }
}
