const Main = imports.ui.main;
const Gio = imports.gi.Gio;
const Meta = imports.gi.Meta;

let monitorManager;
let monitorAddedId;
let keybindingIds = [];

function init() {
}

function enable() {
    monitorManager = Meta.MonitorManager.get();
    
    monitorAddedId = monitorManager.connect('monitors-changed', _onMonitorsChanged);
    
    _addKeybindings();
    
    global.log("Panel Copy Extension: Enabled");
}

function disable() {
    if (monitorAddedId) {
        monitorManager.disconnect(monitorAddedId);
        monitorAddedId = null;
    }
    
    _removeKeybindings();
    
    global.log("Panel Copy Extension: Disabled");
}

function _addKeybindings() {
    Main.keybindingManager.addHotKey(
        "panel-copy-up",
        "<Super><Alt>Up",
        function() { _copyPanelDirection('top'); }
    );
    
    Main.keybindingManager.addHotKey(
        "panel-copy-down",
        "<Super><Alt>Down",
        function() { _copyPanelDirection('bottom'); }
    );
    
    Main.keybindingManager.addHotKey(
        "panel-copy-left",
        "<Super><Alt>Left",
        function() { _copyPanelDirection('left'); }
    );
    
    Main.keybindingManager.addHotKey(
        "panel-copy-right",
        "<Super><Alt>Right",
        function() { _copyPanelDirection('right'); }
    );
}

function _removeKeybindings() {
    Main.keybindingManager.removeHotKey("panel-copy-up");
    Main.keybindingManager.removeHotKey("panel-copy-down");
    Main.keybindingManager.removeHotKey("panel-copy-left");
    Main.keybindingManager.removeHotKey("panel-copy-right");
}

function _onMonitorsChanged() {
    let currentMonitorCount = Main.layoutManager.monitors.length;
    
    global.log("Panel Copy Extension: Monitor count changed to " + currentMonitorCount);
    
    if (currentMonitorCount > 1) {
        _copyAllPanelsToNewMonitor();
    }
}

function _copyAllPanelsToNewMonitor() {
    try {
        _cleanOrphanedApplets();
        
        let panelSettings = new Gio.Settings({ schema_id: 'org.cinnamon' });
        let appletSettings = new Gio.Settings({ schema_id: 'org.cinnamon' });
        
        let panels = panelSettings.get_strv('panels-enabled');
        let applets = appletSettings.get_strv('enabled-applets');
        
        let monitorCount = Main.layoutManager.monitors.length;
        let targetMonitor = (monitorCount - 1).toString();
        
        let monitor0Panels = [];
        for (let i = 0; i < panels.length; i++) {
            let parts = panels[i].split(':');
            if (parts[1] === '0') {
                monitor0Panels.push(panels[i]);
            }
        }
        
        if (monitor0Panels.length === 0) {
            return;
        }
        
        let newPanels = [];
        let newApplets = [];
        let totalSkipped = 0;
        
        for (let i = 0; i < monitor0Panels.length; i++) {
            let panelStr = monitor0Panels[i];
            let parts = panelStr.split(':');
            let sourcePanelId = parts[0];
            let position = parts[2];
            
            let existsOnTarget = false;
            for (let j = 0; j < panels.length; j++) {
                let targetParts = panels[j].split(':');
                if (targetParts[1] === targetMonitor && targetParts[2] === position) {
                    existsOnTarget = true;
                    break;
                }
            }
            
            if (existsOnTarget) {
                continue;
            }
            
            let newPanelId = _getNextPanelId(panels.concat(newPanels));
            
            let sourceApplets = [];
            for (let j = 0; j < applets.length; j++) {
                if (applets[j].startsWith('panel' + sourcePanelId + ':')) {
                    sourceApplets.push(applets[j]);
                }
            }
            
            let skippedCount = 0;
            
            for (let j = 0; j < sourceApplets.length; j++) {
                let applet = sourceApplets[j];
                let appletParts = applet.split(':');
                let zone = appletParts[1];
                let order = appletParts[2];
                
                let rest = appletParts.slice(3).join(':');
                let lastColonIndex = rest.lastIndexOf(':');
                let fullUuid = rest.substring(0, lastColonIndex);
                let instanceId = rest.substring(lastColonIndex + 1);
                
                if (!_isMultipleInstanceApplet(fullUuid)) {
                    skippedCount++;
                    continue;
                }
                
                let newId = _getNextAppletId(applets.concat(newApplets));
                let newApplet = 'panel' + newPanelId + ':' + zone + ':' + order + ':' + fullUuid + ':' + newId;
                newApplets.push(newApplet);
            }
            
            totalSkipped += skippedCount;
            
            let newPanelStr = newPanelId + ':' + targetMonitor + ':' + position;
            newPanels.push(newPanelStr);
        }
        
        if (newPanels.length > 0) {
            let finalApplets = applets.concat(newApplets);
            appletSettings.set_strv('enabled-applets', finalApplets);
            
            let finalPanels = panels.concat(newPanels);
            panelSettings.set_strv('panels-enabled', finalPanels);
            
            let message = "Copied " + newPanels.length + " panel(s) to monitor " + targetMonitor;
            if (totalSkipped > 0) {
                message += " (" + totalSkipped + " single-instance applet" + (totalSkipped > 1 ? "s" : "") + " skipped)";
            }
            Main.notify("Panel Copy Extension", message);
        }
        
    } catch (e) {
        Main.notify("Panel Copy Extension", "Error copying panels: " + e.toString());
    }
}

function _copyPanelDirection(direction) {
    try {
        _cleanOrphanedApplets();
        
        let panelSettings = new Gio.Settings({ schema_id: 'org.cinnamon' });
        let appletSettings = new Gio.Settings({ schema_id: 'org.cinnamon' });
        
        let panels = panelSettings.get_strv('panels-enabled');
        let applets = appletSettings.get_strv('enabled-applets');
        
        let oppositePosition = _getOppositePosition(direction);
        
        let sourcePanel = null;
        let sourcePanelId = null;
        let monitor = null;
        
        for (let i = 0; i < panels.length; i++) {
            let parts = panels[i].split(':');
            if (parts[2] === oppositePosition) {
                sourcePanel = panels[i];
                sourcePanelId = parts[0];
                monitor = parts[1];
                break;
            }
        }
        
        if (!sourcePanel) {
            Main.notify("Panel Copy Extension", "No panel found at " + oppositePosition);
            return;
        }
        
        for (let i = 0; i < panels.length; i++) {
            let parts = panels[i].split(':');
            if (parts[1] === monitor && parts[2] === direction) {
                Main.notify("Panel Copy Extension", "Panel already exists at " + direction);
                return;
            }
        }
        
        let newPanelId = _getNextPanelId(panels);
        
        let sourceApplets = [];
        for (let i = 0; i < applets.length; i++) {
            if (applets[i].startsWith('panel' + sourcePanelId + ':')) {
                sourceApplets.push(applets[i]);
            }
        }
        
        let newApplets = [];
        let skippedCount = 0;
        
        for (let i = 0; i < sourceApplets.length; i++) {
            let applet = sourceApplets[i];
            let appletParts = applet.split(':');
            let zone = appletParts[1];
            let order = appletParts[2];
            
            let rest = appletParts.slice(3).join(':');
            let lastColonIndex = rest.lastIndexOf(':');
            let fullUuid = rest.substring(0, lastColonIndex);
            let instanceId = rest.substring(lastColonIndex + 1);
            
            if (!_isMultipleInstanceApplet(fullUuid)) {
                skippedCount++;
                continue;
            }
            
            let newId = _getNextAppletId(applets.concat(newApplets));
            let newApplet = 'panel' + newPanelId + ':' + zone + ':' + order + ':' + fullUuid + ':' + newId;
            newApplets.push(newApplet);
        }
        
        let finalApplets = applets.concat(newApplets);
        appletSettings.set_strv('enabled-applets', finalApplets);
        
        let newPanelStr = newPanelId + ':' + monitor + ':' + direction;
        panels.push(newPanelStr);
        panelSettings.set_strv('panels-enabled', panels);
        
        let message = "Panel copied from " + oppositePosition + " to " + direction;
        if (skippedCount > 0) {
            message += " (" + skippedCount + " single-instance applet" + (skippedCount > 1 ? "s" : "") + " skipped)";
        }
        Main.notify("Panel Copy Extension", message);
        
    } catch (e) {
        Main.notify("Panel Copy Extension", "Error: " + e.toString());
    }
}

function _getOppositePosition(direction) {
    if (direction === 'top') return 'bottom';
    if (direction === 'bottom') return 'top';
    if (direction === 'left') return 'right';
    if (direction === 'right') return 'left';
    return 'bottom';
}

function _cleanOrphanedApplets() {
    let panelSettings = new Gio.Settings({ schema_id: 'org.cinnamon' });
    let appletSettings = new Gio.Settings({ schema_id: 'org.cinnamon' });
    
    let panels = panelSettings.get_strv('panels-enabled');
    let applets = appletSettings.get_strv('enabled-applets');
    
    let validPanelIds = [];
    for (let i = 0; i < panels.length; i++) {
        let panelId = panels[i].split(':')[0];
        validPanelIds.push(panelId);
    }
    
    let cleanedApplets = [];
    for (let i = 0; i < applets.length; i++) {
        let applet = applets[i];
        let panelPart = applet.split(':')[0];
        let panelId = panelPart.replace('panel', '');
        
        if (validPanelIds.indexOf(panelId) !== -1) {
            cleanedApplets.push(applet);
        }
    }
    
    if (cleanedApplets.length !== applets.length) {
        appletSettings.set_strv('enabled-applets', cleanedApplets);
    }
}

function _isMultipleInstanceApplet(uuid) {
    try {
        const AppletManager = imports.ui.appletManager;
        
        if (!AppletManager.appletMeta || !AppletManager.appletMeta[uuid]) {
            return false;
        }
        
        let appletPath = AppletManager.appletMeta[uuid].path;
        let metadataFile = Gio.File.new_for_path(appletPath + '/metadata.json');
        
        if (!metadataFile.query_exists(null)) {
            return false;
        }
        
        let [success, contents] = metadataFile.load_contents(null);
        if (!success) {
            return false;
        }
        
        let metadataStr = contents.toString();
        let metadata = JSON.parse(metadataStr);
        
        if (!metadata.hasOwnProperty('max-instances')) {
            return false;
        }
        
        let maxInstances = metadata['max-instances'];
        
        if (typeof maxInstances === 'string') {
            maxInstances = parseInt(maxInstances);
        }
        
        return (maxInstances !== 1);
        
    } catch (e) {
        return false;
    }
}

function _getNextPanelId(panels) {
    let maxId = 0;
    for (let i = 0; i < panels.length; i++) {
        let id = parseInt(panels[i].split(':')[0]);
        if (!isNaN(id) && id > maxId) maxId = id;
    }
    return (maxId + 1).toString();
}

function _getNextAppletId(applets) {
    let maxId = 0;
    for (let i = 0; i < applets.length; i++) {
        let lastColon = applets[i].lastIndexOf(':');
        if (lastColon !== -1) {
            let id = parseInt(applets[i].substring(lastColon + 1));
            if (!isNaN(id) && id > maxId) maxId = id;
        }
    }
    return (maxId + 1).toString();
}