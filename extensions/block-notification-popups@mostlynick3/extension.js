const MessageTray = imports.ui.messageTray;
const Main = imports.ui.main;
const AppletManager = imports.ui.appletManager;
const Settings = imports.ui.settings;

let originalShowNotification;
let settings;
let signalId;

function enable() {
    if (!Main.messageTray) return;
    
    settings = new Settings.ExtensionSettings(this, "block-notification-popups@mostlynick3");
    
    originalShowNotification = Main.messageTray._showNotification;
    
    Main.messageTray._showNotification = function() {
        this._notification = this._notificationQueue.shift();
        
        let blockedApps = settings.getValue("blocked-apps");
        let sourceTitle = this._notification.source.title || "";
        
        global.log('[No Notification Popups] Notification from: ' + sourceTitle);
        
        let isBlocked = false;
        for (let i = 0; i < blockedApps.length; i++) {
            let blockedName = blockedApps[i].app || blockedApps[i];
            if (sourceTitle.toLowerCase().includes(blockedName.toLowerCase())) {
                isBlocked = true;
                global.log('[No Notification Popups] BLOCKED: ' + sourceTitle);
                break;
            }
        }
        
        if (isBlocked) {
            // Blocked: Play sound and send to tray, but no popup
            if (!this._notification.silent || this._notification.urgency >= MessageTray.Urgency.HIGH) {
                Main.soundManager.play('notification');
            }
            
            if (AppletManager.get_role_provider_exists(AppletManager.Roles.NOTIFICATIONS)) {
                this.emit('notify-applet-update', this._notification);
            }
            
            this._notificationState = MessageTray.State.HIDDEN;
            this._notification = null;
        } else {
            // Not blocked: Put notification back and call original function
            this._notificationQueue.unshift(this._notification);
            originalShowNotification.call(this);
        }
    };
    
    signalId = settings.connect("changed::blocked-apps", function() {
        global.log('[No Notification Popups] Blocked apps list updated');
    });
}

function disable() {
    if (Main.messageTray && originalShowNotification) {
        Main.messageTray._showNotification = originalShowNotification;
    }
    if (signalId) {
        settings.disconnect(signalId);
    }
}

function init() {
}