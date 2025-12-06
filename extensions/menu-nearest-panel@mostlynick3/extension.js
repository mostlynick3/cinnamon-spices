const Main = imports.ui.main;
const St = imports.gi.St;
const Settings = imports.ui.settings;

let menuApplets = [];
let signalIds = [];
let settings;

function findMenuApplets() {
    menuApplets = [];
    if (!Main.panelManager || !Main.panelManager.panels) {
        return;
    }
    
    global.log('[menu-nearest-panel] Finding menu applets...');
    for (let i = 0; i < Main.panelManager.panels.length; i++) {
        let panel = Main.panelManager.panels[i];
        if (!panel) continue;
        
        let boxes = [panel._leftBox, panel._centerBox, panel._rightBox];
        for (let box of boxes) {
            let children = box.get_children();
            for (let child of children) {
                if (child._applet && child._applet._uuid === 'menu@cinnamon.org') {
                    global.log('[menu-nearest-panel] Found menu applet on panel ' + i + ' monitor ' + panel.monitorIndex);
                    menuApplets.push({
                        applet: child._applet,
                        actor: child,
                        monitorIndex: panel.monitorIndex
                    });
                }
            }
        }
    }
    global.log('[menu-nearest-panel] Total menu applets found: ' + menuApplets.length);
}

function getMonitorAtPoint(x, y) {
    for (let i = 0; i < Main.layoutManager.monitors.length; i++) {
        let monitor = Main.layoutManager.monitors[i];
        if (x >= monitor.x && x < monitor.x + monitor.width &&
            y >= monitor.y && y < monitor.y + monitor.height) {
            return i;
        }
    }
    return -1;
}

function getClosestMenuApplet(openedApplet) {
    let [pointerX, pointerY] = global.get_pointer();
    let pointerMonitor = getMonitorAtPoint(pointerX, pointerY);
    
    global.log('[menu-nearest-panel] ========== DISTANCE CALCULATION ==========');
    global.log('[menu-nearest-panel] Mouse position: (' + pointerX + ', ' + pointerY + ')');
    global.log('[menu-nearest-panel] Mouse monitor: ' + pointerMonitor);
    global.log('[menu-nearest-panel] Menu opened from applet index: ' + menuApplets.findIndex(item => item.applet === openedApplet));
    
    let closestApplet = null;
    let minDistance = Infinity;
    
    let perMonitor = settings.getValue('per-monitor');
    global.log('[menu-nearest-panel] Per-monitor mode: ' + perMonitor);

    for (let i = 0; i < menuApplets.length; i++) {
        let item = menuApplets[i];
        let actor = item.actor;
        
        if (!actor) {
            global.log('[menu-nearest-panel] Applet ' + i + ': NO ACTOR - SKIPPED');
            continue;
        }
        
        if (perMonitor && item.monitorIndex !== pointerMonitor) {
            global.log('[menu-nearest-panel] Applet ' + i + ': on monitor ' + item.monitorIndex + ' - SKIPPED (wrong monitor)');
            continue;
        }
        
        let [actorX, actorY] = actor.get_transformed_position();
        let [actorW, actorH] = actor.get_transformed_size();
        
        let centerX = actorX + actorW / 2;
        let centerY = actorY + actorH / 2;
        
        let distance = Math.sqrt(
            Math.pow(pointerX - centerX, 2) +
            Math.pow(pointerY - centerY, 2)
        );
        
        global.log('[menu-nearest-panel] Applet ' + i + ':');
        global.log('[menu-nearest-panel]   Position: (' + actorX + ', ' + actorY + ')');
        global.log('[menu-nearest-panel]   Size: ' + actorW + 'x' + actorH);
        global.log('[menu-nearest-panel]   Center: (' + centerX + ', ' + centerY + ')');
        global.log('[menu-nearest-panel]   Distance: ' + distance.toFixed(2) + ' pixels');
        global.log('[menu-nearest-panel]   Monitor: ' + item.monitorIndex);
        
        if (distance < minDistance) {
            minDistance = distance;
            closestApplet = item.applet;
            global.log('[menu-nearest-panel]   ** NEW CLOSEST **');
        }
    }
    
    global.log('[menu-nearest-panel] ========== RESULT ==========');
    global.log('[menu-nearest-panel] Closest applet index: ' + menuApplets.findIndex(item => item.applet === closestApplet));
    global.log('[menu-nearest-panel] Minimum distance: ' + (minDistance !== Infinity ? minDistance.toFixed(2) : 'N/A') + ' pixels');
    
    return closestApplet;
}

function onMenuOpened(applet) {
    global.log('[menu-nearest-panel] ========== MENU OPENED EVENT ==========');
    
    let closestApplet = getClosestMenuApplet(applet);
    
    if (closestApplet && closestApplet !== applet) {
        global.log('[menu-nearest-panel] DECISION: REDIRECT to different applet');
        if (closestApplet.menu) {
            applet.menu.close(false);
            closestApplet.menu.open(false);
            global.log('[menu-nearest-panel] Redirect executed');
        } else {
            global.log('[menu-nearest-panel] ERROR: Closest applet has no menu');
        }
    } else if (closestApplet === applet) {
        global.log('[menu-nearest-panel] DECISION: NO REDIRECT (already at closest applet)');
    } else {
        global.log('[menu-nearest-panel] DECISION: NO REDIRECT (no closest applet found)');
    }
    global.log('[menu-nearest-panel] =====================================');
}

function enable() {
    settings = new Settings.ExtensionSettings(this, "menu-nearest-panel@mostlynick3");
    
    findMenuApplets();
    
    for (let item of menuApplets) {
        let id = item.applet.menu.connect('open-state-changed', function(menu, open) {
            if (open) {
                onMenuOpened(item.applet);
            }
        });
        signalIds.push({ menu: item.applet.menu, id: id });
    }
    
    global.log('[menu-nearest-panel] Extension enabled with ' + signalIds.length + ' signal connections');
}

function disable() {
    for (let signal of signalIds) {
        signal.menu.disconnect(signal.id);
    }
    signalIds = [];
    menuApplets = [];
    global.log('[menu-nearest-panel] Extension disabled');
}

function init() {
}