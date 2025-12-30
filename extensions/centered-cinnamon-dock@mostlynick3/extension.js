const Main = imports.ui.main;
const Settings = imports.ui.settings;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const Clutter = imports.gi.Clutter;
const Tweener = imports.ui.tweener;

let settings;
let panelStates = {};
let sizeCheckTimeout;
let pointerWatcher;
let workspaceSignal;
let actorAddedSignal;
let editModeSignal;
let displayStateSignal;
let isInEditMode = false;
let settingsCallbacks = {};
let windowCreatedSignal;
let isTransitioningWorkspace = false;

function init(metadata) {
}

function enable() {
    settings = new Settings.ExtensionSettings(this, "centered-cinnamon-dock@mostlynick3");
    
    settingsCallbacks.transparency = function() {
        if (!isInEditMode) {
            applyStyleToAll();
        }
    };
    settings.bind("transparency", "transparency", settingsCallbacks.transparency);
    
    settingsCallbacks.heightOffset = function() {
        if (!isInEditMode) {
            applyStyleToAll();
            updateMenuPositions();
        }
    };
    settings.bind("height-offset", "heightOffset", settingsCallbacks.heightOffset);
    
    settingsCallbacks.autoHide = function() {
        toggleAutoHide();
    };
    settings.bind("auto-hide", "autoHide", settingsCallbacks.autoHide);
    
    settingsCallbacks.hoverPixels = function() {
        if (settings.getValue("auto-hide")) {
            disableAutoHide();
            enableAutoHide();
        }
    };
    settings.bind("hover-pixels", "hoverPixels", settingsCallbacks.hoverPixels);
    
    settingsCallbacks.noWindowShift = function() {
        Main.panelManager.panels.forEach(panel => {
            if (shouldApplyToPanel(panel)) {
                if (settings.getValue("no-window-shift")) {
                    Main.layoutManager._chrome.modifyActorParams(panel.actor, { affectsStruts: false });
                } else {
                    Main.layoutManager._chrome.modifyActorParams(panel.actor, { affectsStruts: true });
                }
            }
        });
    };
    settings.bind("no-window-shift", "noWindowShift", settingsCallbacks.noWindowShift);
    
    settingsCallbacks.animationTime = function() {
    };
    settings.bind("animation-time", "animationTime", settingsCallbacks.animationTime);
    
    settingsCallbacks.showOnNoFocus = function() {
        if (settings.getValue("auto-hide")) {
            disableAutoHide();
            enableAutoHide();
        }
    };
    settings.bind("show-on-no-focus", "showOnNoFocus", settingsCallbacks.showOnNoFocus);
    
    settingsCallbacks.panelMode = function() {
        cleanupAllPanels();
        Mainloop.timeout_add(50, function() {
            initializePanels();
            return false;
        });
    };
    settings.bind("panel-mode", "panelMode", settingsCallbacks.panelMode);
    
    settingsCallbacks.zoomFactor = function() {
    };
    settings.bind("zoom-factor", "zoomFactor", settingsCallbacks.zoomFactor);
    
    settingsCallbacks.zoomEnabled = function() {
        Main.panelManager.panels.forEach(panel => {
            if (shouldApplyToPanel(panel)) {
                setupAppletZoom(panel);
            }
        });
    };
    settings.bind("zoom-enabled", "zoomEnabled", settingsCallbacks.zoomEnabled);

	settingsCallbacks.indicatorColor = function() {
			if (settings.getValue("auto-hide")) {
				disableAutoHide();
				enableAutoHide();
			}
		};
    settings.bind("indicator-color", "indicatorColor", settingsCallbacks.indicatorColor);

	settingsCallbacks.enabledPanels = function() {
		cleanupAllPanels();
		Mainloop.timeout_add(50, function() {
			initializePanels();
			return false;
		});
	};
	settings.bind("enabled-panels", "enabledPanels", settingsCallbacks.enabledPanels);

    isInEditMode = global.settings.get_boolean("panel-edit-mode");
    
    editModeSignal = global.settings.connect("changed::panel-edit-mode", function() {
        let newEditMode = global.settings.get_boolean("panel-edit-mode");
        if (newEditMode !== isInEditMode) {
            isInEditMode = newEditMode;
            handleEditModeChange();
        }
    });
    
	displayStateSignal = Main.layoutManager.connect('monitors-changed', function() {
		if (isInEditMode) return;
		
		disableAutoHide();
		panelStates = {};
		
		Mainloop.idle_add(function() {
			initializePanels();
			return false;
		});
	});
    
    initializePanels();
}

function handleEditModeChange() {
    if (isInEditMode) {
        enterEditMode();
    } else {
        exitEditMode();
    }
}

function enterEditMode() {
    Main.panelManager.panels.forEach(panel => {
        if (shouldApplyToPanel(panel)) {
            let state = panelStates[panel.panelId];
            if (state) {
                state.savedOpacity = panel.actor.opacity;
                state.wasHidden = state.isHidden;
                
                Tweener.removeTweens(panel.actor);
                panel.actor.set_style('');
                panel.actor.y = state.originalY;
                panel.actor.opacity = 255;
                panel.actor.show();
                
                cleanupAppletZoom(panel);
            }
        }
    });
}

function exitEditMode() {
    Main.panelManager.panels.forEach(panel => {
        if (shouldApplyToPanel(panel)) {
            let state = panelStates[panel.panelId];
            if (state) {
                state.originalY = panel.actor.y;
            }
        }
    });
    
    Mainloop.timeout_add(150, function() {
        Main.panelManager.panels.forEach(panel => {
            if (shouldApplyToPanel(panel)) {
                let state = panelStates[panel.panelId];
                if (state) {
                    state.lastWidth = 0;
                    checkAndApplyStyle(panel, true);
                    setupAppletZoom(panel);
                    
                    if (state.wasHidden && settings.getValue("auto-hide")) {
                        Mainloop.timeout_add(100, function() {
                            state.isHidden = false;
                            hidePanel(panel);
                            return false;
                        });
                    }
                }
            }
        });
        return false;
    });
}


function cleanupAllPanels() {
    disableAutoHide();

    if (displayStateSignal) {
        Main.layoutManager.disconnect(displayStateSignal);
        displayStateSignal = null;
    }

    if (sizeCheckTimeout) {
        Mainloop.source_remove(sizeCheckTimeout);
        sizeCheckTimeout = null;
    }
    
    if (workspaceSignal) {
        global.screen.disconnect(workspaceSignal);
        workspaceSignal = null;
    }
    
    if (actorAddedSignal) {
        global.stage.disconnect(actorAddedSignal);
        actorAddedSignal = null;
    }
    
    if (editModeSignal) {
        global.settings.disconnect(editModeSignal);
        editModeSignal = null;
    }
    
    if (windowCreatedSignal) {
        global.display.disconnect(windowCreatedSignal);
        windowCreatedSignal = null;
    }
    
    Main.panelManager.panels.forEach(panel => {
        let state = panelStates[panel.panelId];
        
        Tweener.removeTweens(panel.actor);
        
        if (state) {
            destroyIndicator(panel);
            
            if (state.hideDelayTimeout) {
                Mainloop.source_remove(state.hideDelayTimeout);
                state.hideDelayTimeout = null;
            }
            
            if (state.animationTimer) {
                Mainloop.source_remove(state.animationTimer);
                state.animationTimer = null;
            }
            
            if (state.styleSignal !== null && state.styleSignal !== undefined) {
                try {
                    panel.actor.disconnect(state.styleSignal);
                } catch(e) {}
                state.styleSignal = null;
            }

            if (state.showSignal !== null && state.showSignal !== undefined) {
                try {
                    panel.actor.disconnect(state.showSignal);
                } catch(e) {}
                state.showSignal = null;
            }
            
            cleanupAppletZoom(panel);
            
            panel.actor.y = state.originalY;
        }
        
        panel.actor.set_scale(1.0, 1.0);
        panel.actor.set_style('');
        panel.actor.opacity = 255;
        panel.actor.show();
        Main.layoutManager._chrome.modifyActorParams(panel.actor, { affectsStruts: true });
    });
    
    panelStates = {};
}

function initializePanels() {
    Main.panelManager.panels.forEach(panel => {
        if (shouldApplyToPanel(panel)) {
            if (!panelStates[panel.panelId]) {
                initPanel(panel);
            }
            panel.actor.show();
            panel.actor.opacity = 255;
        }
    });
    
    actorAddedSignal = global.stage.connect('actor-added', function(stage, actor) {
        if (actor.has_style_class_name && actor.has_style_class_name('popup-menu')) {
            Main.panelManager.panels.forEach(panel => {
                if (shouldApplyToPanel(panel)) {
                    let state = panelStates[panel.panelId];
                    if (state) {
                        state.trackedMenus.push(actor);
                        if (!isInEditMode) {
                            updateMenuPosition(panel, actor);
                        }
                    }
                }
            });
        }
    });
    
	workspaceSignal = global.screen.connect('workspace-switched', function() {
		if (isInEditMode) return;
		
		Main.panelManager.panels.forEach(panel => {
			if (shouldApplyToPanel(panel)) {
				let state = panelStates[panel.panelId];
				if (state) {
					Tweener.removeTweens(panel.actor);
					if (state.indicator) {
						Tweener.removeTweens(state.indicator);
						destroyIndicator(panel);
					}
					if (state.hideDelayTimeout) {
						Mainloop.source_remove(state.hideDelayTimeout);
						state.hideDelayTimeout = null;
					}
					if (state.animationTimer) {
						Mainloop.source_remove(state.animationTimer);
						state.animationTimer = null;
					}
					
					state.isHidden = false;
					state.isHiding = false;
					state.isShowing = false;
					state.lastWidth = 0;
					panel.actor.opacity = 0;
					panel.actor.show();
					
					checkAndApplyStyle(panel, true);
				}
			}
		});
		
		Mainloop.timeout_add(100, function() {
			if (settings.getValue("auto-hide")) {
				Main.panelManager.panels.forEach(panel => {
					if (shouldApplyToPanel(panel)) {
						hidePanel(panel);
					}
				});
			}
			return false;
		});
	});

    windowCreatedSignal = global.display.connect('window-created', function(display, win) {
        if (isInEditMode) return;
        
        win.connect('unmanaged', function() {
            if (isInEditMode) return;
            Main.panelManager.panels.forEach(panel => {
                if (shouldApplyToPanel(panel)) {
                    checkAndApplyStyle(panel, true);
                }
            });
        });
        
        Main.panelManager.panels.forEach(panel => {
            if (shouldApplyToPanel(panel)) {
                checkAndApplyStyle(panel, true);
            }
        });
    });
    
    Mainloop.timeout_add(100, function() {
        if (!isInEditMode) {
            Main.panelManager.panels.forEach(panel => {
                if (shouldApplyToPanel(panel)) {
                    checkAndApplyStyle(panel);
                    setupAppletZoom(panel);
                }
            });
        }
        startSizeMonitoring();
        toggleAutoHide();
        return false;
    });
}

function getPanelLocation(panel) {
    let monitor = Main.layoutManager.findMonitorForActor(panel.actor);
    if (!monitor) return "unknown";
    
    let panelY = panel.actor.y;
    let panelX = panel.actor.x;
    let panelWidth = panel.actor.width;
    let panelHeight = panel.actor.height;
    
    if (panelY <= monitor.y + 10) {
        return "top";
    } else if (panelY + panelHeight >= monitor.y + monitor.height - 10) {
        return "bottom";
    } else if (panelX <= monitor.x + 10) {
        return "left";
    } else if (panelX + panelWidth >= monitor.x + monitor.width - 10) {
        return "right";
    }
    
    return "unknown";
}

function getPanelIdentifier(panel) {
    let monitor = Main.layoutManager.findMonitorForActor(panel.actor);
    let monitorIndex = monitor ? Main.layoutManager.monitors.indexOf(monitor) : 0;
    let location = getPanelLocation(panel);
    return `monitor${monitorIndex}_${location}`;
}

function shouldApplyToPanel(panel) {
    let mode = settings.getValue("panel-mode");
    
    if (mode === "custom-selection") {
        let panelId = getPanelIdentifier(panel);
        let enabledPanels = settings.getValue("enabled-panels");
        return enabledPanels.includes(panelId);
    }
    
    let location = getPanelLocation(panel);
    
    if (mode === "main") {
        return panel === Main.panel;
    } else if (mode === "bottom") {
        return location === "bottom";
    } else if (mode === "top") {
        return location === "top";
    } else if (mode === "both") {
        return location === "bottom" || location === "top";
    }
    
    return false;
}

function initPanel(panel) {
    panelStates[panel.panelId] = {
        originalY: panel.actor.y,
        lastWidth: 0,
        trackedMenus: [],
        isHidden: false,
        location: getPanelLocation(panel),
        savedOpacity: 255,
        wasHidden: false,
        styleSignal: null,
        showSignal: null,
        zoomEnterId: null,
        zoomLeaveId: null,
        indicator: null,
        hideDelayTimeout: null,
        animationTimer: null
    };
    
    let state = panelStates[panel.panelId];
    
    if (settings.getValue("no-window-shift")) {
        Main.layoutManager._chrome.modifyActorParams(panel.actor, { affectsStruts: false });
    }
    
    state.styleSignal = panel.actor.connect('style-changed', function() {
        if (isInEditMode) return;
        
        Mainloop.timeout_add(10, function() {
            applyStyle(panel);
            return false;
        });
    });
    
    state.showSignal = panel.actor.connect('show', function() {
        if (isInEditMode) return;
        
        let state = panelStates[panel.panelId];
        if (state && state.isHidden && settings.getValue("auto-hide")) {
            panel.actor.hide();
            state.isHidden = false;
        }
    });
}

function setupAppletZoom(panel) {
    if (isInEditMode) return;
    
    let state = panelStates[panel.panelId];
    if (!state) return;
    
    cleanupAppletZoom(panel);
    
    if (!settings.getValue("zoom-enabled")) return;
    
    state.zoomEnterId = panel.actor.connect('enter-event', function(actor, event) {
        let target = event.get_source();
        if (target && target !== panel.actor && !isLayoutContainer(target)) {
            zoomApplet(target, true);
        }
    });
    
    state.zoomLeaveId = panel.actor.connect('leave-event', function(actor, event) {
        let target = event.get_source();
        if (target && target !== panel.actor) {
            zoomApplet(target, false);
        }
    });
}

function isLayoutContainer(actor) {
    let actorType = actor.toString();
    
    if (actorType.includes('StBoxLayout') || 
        actorType.includes('St.BoxLayout') ||
        actorType.includes('StBin') ||
        actorType.includes('ClutterActor') ||
        actorType.includes('St.Bin')) {
        return true;
    }
	
    return false;
}

function cleanupAppletZoom(panel) {
    let state = panelStates[panel.panelId];
    if (!state) return;
    
    if (state.zoomEnterId) {
        try {
            panel.actor.disconnect(state.zoomEnterId);
        } catch(e) {}
        state.zoomEnterId = null;
    }
    
    if (state.zoomLeaveId) {
        try {
            panel.actor.disconnect(state.zoomLeaveId);
        } catch(e) {}
        state.zoomLeaveId = null;
    }
}

function zoomApplet(actor, zoomIn) {
    if (isInEditMode) return;
    
    Tweener.removeTweens(actor);
    
    actor.set_pivot_point(0.5, 0.5);
    
    let zoomFactor = settings.getValue("zoom-factor") || 1.3;
    let targetScale = zoomIn ? zoomFactor : 1.0;
    
    Tweener.addTween(actor, {
        scale_x: targetScale,
        scale_y: targetScale,
        time: 0.15,
        transition: 'easeOutQuad'
    });
}
function resetAllAppletZoom(panel) {
    let boxes = [panel._leftBox, panel._centerBox, panel._rightBox];
    
    boxes.forEach(box => {
        let children = box.get_children();
        children.forEach(child => {
            applyZoomToActor(child, 1.0);
        });
    });
}

function applyZoomToActor(actor, scale) {
    Tweener.removeTweens(actor);
    
    actor.set_pivot_point(0.5, 0.5);
    
    Tweener.addTween(actor, {
        scale_x: scale,
        scale_y: scale,
        time: 0.1,
        transition: 'easeOutQuad'
    });
}

function cleanupTrackedMenus(panel) {
    let state = panelStates[panel.panelId];
    if (!state) return;
    
    state.trackedMenus = state.trackedMenus.filter(menu => {
        try {
            return menu && !menu.is_finalized();
        } catch(e) {
            return false;
        }
    });
}

function hasActiveMenus(panel) {
    let state = panelStates[panel.panelId];
    if (!state) return false;
    
    cleanupTrackedMenus(panel);
    
    for (let i = 0; i < state.trackedMenus.length; i++) {
        let menu = state.trackedMenus[i];
        try {
            if (menu.visible) {
                return true;
            }
        } catch(e) {
            continue;
        }
    }
    
    if (panel._menus) {
        for (let i = 0; i < panel._menus._menus.length; i++) {
            let menu = panel._menus._menus[i];
            if (menu.menu && menu.menu.isOpen) {
                return true;
            }
        }
    }
    
    if (panel._leftBox) {
        let boxes = [panel._leftBox, panel._centerBox, panel._rightBox];
        for (let box of boxes) {
            let children = box.get_children();
            for (let child of children) {
                if (child._applet && child._applet.menu && child._applet.menu.isOpen) {
                    return true;
                }
                if (child._delegate && child._delegate.menu && child._delegate.menu.isOpen) {
                    return true;
                }
            }
        }
    }
    
    return false;
}

function isMouseOverDockOrMenus(panel) {
    let [x, y, mods] = global.get_pointer();
    let actor = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
	
    if (!actor) {
        return false;
    }
    
    while (actor) {
        if (actor === panel.actor) {
            return true;
        }
        
        if (actor._delegate && actor._delegate._applet && 
            panel.actor.contains(actor._delegate._applet.actor)) {
            return true;
        }
        
        if (actor.has_style_class_name && 
            (actor.has_style_class_name('popup-menu') || 
             actor.has_style_class_name('menu') ||
             actor.has_style_class_name('popup-menu-content') ||
             actor.has_style_class_name('popup-menu-item') ||
             actor.has_style_class_name('item-box'))) {

            let parent = actor;
            while (parent) {
                if (parent._delegate && parent._delegate.sourceActor) {
                    let sourceActor = parent._delegate.sourceActor;
                    while (sourceActor) {
                        if (panel.actor.contains(sourceActor)) {
                            return true;
                        }
                        sourceActor = sourceActor.get_parent();
                    }
                    return false;
                }
                parent = parent.get_parent();
            }
            return false;
        }
        
        actor = actor.get_parent();
    }
    
    return false;
}

function isMouseInTriggerZone(panel, x, y) {
    let state = panelStates[panel.panelId];
    if (!state) return false;
    
    let monitor = getMonitorGeometry(panel);
    let hoverPixels = settings.getValue("hover-pixels");
    
    let panelLeft = monitor.x + (monitor.width - state.lastWidth) / 2;
    let panelRight = panelLeft + state.lastWidth;
    
    if (x < panelLeft || x > panelRight) {
        return false;
    }
    
    if (state.location === "bottom") {
        return y >= monitor.y + monitor.height - hoverPixels && 
               y <= monitor.y + monitor.height;
    } else if (state.location === "top") {
        return y >= monitor.y && 
               y <= monitor.y + hoverPixels;
    }
    
    return false;
}

function toggleAutoHide() {
    disableAutoHide();
    if (settings.getValue("auto-hide")) {
        enableAutoHide();
    }
}

function getMonitorGeometry(panel) {
    let panelMonitor = Main.layoutManager.findMonitorForActor(panel.actor);
    if (panelMonitor) {
        return {
            x: panelMonitor.x,
            y: panelMonitor.y,
            width: panelMonitor.width,
            height: panelMonitor.height
        };
    }
    return {
        x: 0,
        y: 0,
        width: global.screen_width,
        height: global.screen_height
    };
}

function enableAutoHide(indicatorStatus) {
    disableAutoHide(indicatorStatus);
    
    Main.panelManager.panels.forEach(panel => {
        if (!shouldApplyToPanel(panel)) return;
        let state = panelStates[panel.panelId];
        if (!state) return;
        
        state.hideDelayTimeout = null;
    });
    
    pointerWatcher = Mainloop.timeout_add(100, function() {
        if (isInEditMode) return true;
        
        let [x, y, mods] = global.get_pointer();
        
        Main.panelManager.panels.forEach(panel => {
            if (!shouldApplyToPanel(panel)) return;
            
            let state = panelStates[panel.panelId];
            if (!state) return;
            
            if (state.isHidden && !state.isShowing && !state.isHiding) {
                if (!panel.actor.visible) {
                    panel.actor.show();
                }
                if (panel.actor.opacity !== 0) {
                    panel.actor.opacity = 0;
                }
                
                let [minWidth, leftWidth] = panel._leftBox.get_preferred_width(-1);
                let [minWidth2, centerWidth] = panel._centerBox.get_preferred_width(-1);
                let [minWidth3, rightWidth] = panel._rightBox.get_preferred_width(-1);
                let contentWidth = leftWidth + centerWidth + rightWidth;
                let panelPadding = 20;
                let newWidth = Math.max(contentWidth + (panelPadding * 2), 200);
                
                if (newWidth !== state.lastWidth) {
                    state.lastWidth = newWidth;
                    if (state.indicator && settings.getValue("show-indicator")) {
                        updateIndicator(panel);
                    }
                }
                
                if (settings.getValue("show-indicator") && !state.indicator) {
                    createIndicator(panel);
                }
            }
            
            let menusActive = hasActiveMenus(panel);
            let mouseOverTriggerZone = isMouseInTriggerZone(panel, x, y);
            
            let focusWindow = global.display.focus_window;
            let hasNormalWindow = focusWindow && focusWindow.window_type === Meta.WindowType.NORMAL;
            let showOnNoFocus = settings.getValue("show-on-no-focus");
            let shouldShowOnNoFocus = !hasNormalWindow && showOnNoFocus;
            
            let shouldShow = menusActive || mouseOverTriggerZone || shouldShowOnNoFocus;
            
            if (!state.isHidden) {
                let mouseOverDockOrMenus = isMouseOverDockOrMenus(panel);
                shouldShow = shouldShow || mouseOverDockOrMenus;
            } else if (state.isHiding) {
                if (isMouseOverDockOrMenus(panel)) {
                    shouldShow = true;
                }
            }
            
            if (shouldShow && state.isHidden) {
                if (state.hideDelayTimeout) {
                    Mainloop.source_remove(state.hideDelayTimeout);
                    state.hideDelayTimeout = null;
                }
                showPanel(panel);
            } else if (!shouldShow && !state.isHidden) {
                if (!state.hideDelayTimeout) {
                    let hideDelay = settings.getValue("hide-delay");
                    state.hideDelayTimeout = Mainloop.timeout_add(hideDelay, function() {
                        state.hideDelayTimeout = null;
                        hidePanel(panel);
                        return false;
                    });
                }
            } else if (shouldShow && !state.isHidden && state.hideDelayTimeout) {
                Mainloop.source_remove(state.hideDelayTimeout);
                state.hideDelayTimeout = null;
            }
        });
        
        return true;
    });
}

function createIndicator(panel) {
    let state = panelStates[panel.panelId];
    if (!state) return;
    
    if (state.indicator) {
        destroyIndicator(panel);
    }
    
    let monitor = getMonitorGeometry(panel);
    let hoverPixels = settings.getValue("hover-pixels");
    let transparency = settings.getValue("transparency") / 100.0;
    let indicatorColor = settings.getValue("indicator-color");
    
    let indicator = new imports.gi.St.BoxLayout({
        style_class: 'dock-indicator',
        reactive: false
    });
    
    let indicatorWidth = state.lastWidth;
    let indicatorHeight = hoverPixels;
    let indicatorX = monitor.x + (monitor.width - indicatorWidth) / 2;
    let indicatorY;
    
    if (state.location === "bottom") {
        indicatorY = monitor.y + monitor.height - hoverPixels;
    } else {
        indicatorY = monitor.y;
    }
    
    indicator.set_position(indicatorX, indicatorY);
    indicator.set_size(indicatorWidth, indicatorHeight);
    
    let colorWithTransparency = indicatorColor.replace(/[\d.]+\)$/, transparency + ')');
    
    indicator.set_style(
        'background-color: ' + colorWithTransparency + ';' +
        'border-radius: 12px;'
    );
    
    Main.layoutManager.addChrome(indicator, {
        affectsStruts: false,
        affectsInputRegion: false
    });
    
    state.indicator = indicator;
    state.indicatorOriginalY = indicatorY;
}

function destroyIndicator(panel) {
    let state = panelStates[panel.panelId];
    if (!state || !state.indicator) return;
    
    Main.layoutManager.removeChrome(state.indicator);
    state.indicator.destroy();
    state.indicator = null;
}

function updateIndicator(panel) {
    let state = panelStates[panel.panelId];
    if (!state || !state.indicator) return;
	
    let monitor = getMonitorGeometry(panel);
    let hoverPixels = settings.getValue("hover-pixels");
    let transparency = settings.getValue("transparency") / 100.0;
    let indicatorColor = settings.getValue("indicator-color");
    
    let indicatorWidth = state.lastWidth;
    let indicatorX = monitor.x + (monitor.width - indicatorWidth) / 2;
    let indicatorY;
    
    if (state.location === "bottom") {
        indicatorY = monitor.y + monitor.height - hoverPixels;
    } else {
        indicatorY = monitor.y;
    }
    
    state.indicator.set_position(indicatorX, indicatorY);
    
    Tweener.removeTweens(state.indicator);
    
    Tweener.addTween(state.indicator, {
        width: indicatorWidth,
        time: 0.2,
        transition: 'easeOutQuad',
        onUpdate: function() {
            let currentWidth = state.indicator.width;
            let newX = monitor.x + (monitor.width - currentWidth) / 2;
            state.indicator.x = newX;
        }
    });
    
    let colorWithTransparency = indicatorColor.replace(/[\d.]+\)$/, transparency + ')');
    
    state.indicator.set_style(
        'background-color: ' + colorWithTransparency + ';' +
        'border-radius: 12px;'
    );
}

function showPanel(panel) {
    if (isInEditMode) return;
    
    let state = panelStates[panel.panelId];
    if (!state) return;
    
    if (state.hideDelayTimeout) {
        Mainloop.source_remove(state.hideDelayTimeout);
        state.hideDelayTimeout = null;
    }
    
    if (state.animationTimer) {
        Mainloop.source_remove(state.animationTimer);
        state.animationTimer = null;
    }
    
    state.isHidden = false;
    state.isHiding = false;
    state.isShowing = true;
    state.lastCheckState = true;
    
    panel.actor.set_scale(1.0, 1.0);
    panel.actor.show();
    panel.actor.raise_top();
    
    checkAndApplyStyle(panel);
    
    let animTime = settings.getValue("animation-time");
    let startTime = Date.now();
    let startOpacity = panel.actor.opacity;
    
    if (state.indicator) {
        let monitor = getMonitorGeometry(panel);
        let panelCenterY = state.originalY + (panel.actor.height / 2);
        let heightOffset = settings.getValue("height-offset");
        let adjustedOffset = state.location === "top" ? -heightOffset : heightOffset;
        panelCenterY += adjustedOffset;
        
        let indicatorStartY = state.indicator.y;
        let indicatorStartOpacity = state.indicator.opacity;
        
        state.animationTimer = Mainloop.timeout_add(16, function() {
            let elapsed = Date.now() - startTime;
            let progress = Math.min(elapsed / animTime, 1.0);
            let eased = 1 - Math.pow(1 - progress, 3);
            
            panel.actor.opacity = startOpacity + (255 - startOpacity) * eased;
            state.indicator.opacity = indicatorStartOpacity + (0 - indicatorStartOpacity) * eased;
            state.indicator.y = indicatorStartY + (panelCenterY - indicatorStartY) * eased;
            
            if (progress >= 1.0) {
                panel.actor.opacity = 255;
                state.indicator.opacity = 0;
                state.indicator.y = panelCenterY;
                state.animationTimer = null;
                state.isShowing = false;
                return false;
            }
            return true;
        });
    } else {
        state.animationTimer = Mainloop.timeout_add(16, function() {
            let elapsed = Date.now() - startTime;
            let progress = Math.min(elapsed / animTime, 1.0);
            let eased = 1 - Math.pow(1 - progress, 3);
            
            panel.actor.opacity = startOpacity + (255 - startOpacity) * eased;
            
            if (progress >= 1.0) {
                panel.actor.opacity = 255;
                state.animationTimer = null;
                state.isShowing = false;
                return false;
            }
            return true;
        });
    }
}

function hidePanel(panel) {
    if (isInEditMode) return;
    
    let state = panelStates[panel.panelId];
    if (!state) return;
    
    if (state.isHidden || state.isHiding) return;
    
    if (hasActiveMenus(panel)) {
        return;
    }
    
    if (state.animationTimer) {
        Mainloop.source_remove(state.animationTimer);
        state.animationTimer = null;
    }
    
    state.isHiding = true;
    state.isShowing = false;
    state.lastCheckState = false;
    
    let [minWidth, leftWidth] = panel._leftBox.get_preferred_width(-1);
    let [minWidth2, centerWidth] = panel._centerBox.get_preferred_width(-1);
    let [minWidth3, rightWidth] = panel._rightBox.get_preferred_width(-1);
    let contentWidth = leftWidth + centerWidth + rightWidth;
    let panelPadding = 20;
    state.lastWidth = Math.max(contentWidth + (panelPadding * 2), 200);
    
    let animTime = settings.getValue("animation-time");
    let startTime = Date.now();
    let startOpacity = panel.actor.opacity;
    
    if (settings.getValue("show-indicator")) {
        if (!state.indicator) {
            let monitor = getMonitorGeometry(panel);
            let panelCenterY = state.originalY + (panel.actor.height / 2);
            let heightOffset = settings.getValue("height-offset");
            let adjustedOffset = state.location === "top" ? -heightOffset : heightOffset;
            panelCenterY += adjustedOffset;
            
            createIndicator(panel);
            state.indicator.opacity = 0;
            state.indicator.y = panelCenterY;
        } else {
            let monitor = getMonitorGeometry(panel);
            let panelCenterY = state.originalY + (panel.actor.height / 2);
            let heightOffset = settings.getValue("height-offset");
            let adjustedOffset = state.location === "top" ? -heightOffset : heightOffset;
            panelCenterY += adjustedOffset;
            
            updateIndicator(panel);
            state.indicator.opacity = 0;
            state.indicator.y = panelCenterY;
        }
        
        let indicatorStartY = state.indicator.y;
        let indicatorStartOpacity = state.indicator.opacity;
        
        state.animationTimer = Mainloop.timeout_add(16, function() {
            if (hasActiveMenus(panel) || isMouseOverDockOrMenus(panel)) {
                state.animationTimer = null;
                state.isHiding = false;
                state.isHidden = false;
                showPanel(panel);
                return false;
            }
            
            let elapsed = Date.now() - startTime;
            let progress = Math.min(elapsed / animTime, 1.0);
            let eased = 1 - Math.pow(1 - progress, 3);
            
            panel.actor.opacity = startOpacity + (0 - startOpacity) * eased;
            state.indicator.opacity = indicatorStartOpacity + (255 - indicatorStartOpacity) * eased;
            state.indicator.y = indicatorStartY + (state.indicatorOriginalY - indicatorStartY) * eased;
            
            if (progress >= 1.0) {
                panel.actor.opacity = 0;
                state.indicator.opacity = 255;
                state.indicator.y = state.indicatorOriginalY;
                state.isHidden = true;
                state.isHiding = false;
                if (!hasActiveMenus(panel)) {
                    panel.actor.set_scale(0.0, 0.0);
                } else {
                    state.isHidden = false;
                    showPanel(panel);
                }
                state.animationTimer = null;
                return false;
            }
            return true;
        });
    } else {
        state.animationTimer = Mainloop.timeout_add(16, function() {
            if (hasActiveMenus(panel) || isMouseOverDockOrMenus(panel)) {
                state.animationTimer = null;
                state.isHiding = false;
                state.isHidden = false;
                showPanel(panel);
                return false;
            }
            
            let elapsed = Date.now() - startTime;
            let progress = Math.min(elapsed / animTime, 1.0);
            let eased = 1 - Math.pow(1 - progress, 3);
            
            panel.actor.opacity = startOpacity + (0 - startOpacity) * eased;
            
            if (progress >= 1.0) {
                panel.actor.opacity = 0;
                state.isHidden = true;
                state.isHiding = false;
                if (!hasActiveMenus(panel)) {
                    panel.actor.set_scale(0.0, 0.0);
                } else {
                    state.isHidden = false;
                    showPanel(panel);
                }
                state.animationTimer = null;
                return false;
            }
            return true;
        });
    }
}

function disableAutoHide(indicatorStatus) {
    if (pointerWatcher) {
        Mainloop.source_remove(pointerWatcher);
        pointerWatcher = null;
    }
    
    if (indicatorStatus === "keepIndicators") {
        Main.panelManager.panels.forEach(panel => {
            let state = panelStates[panel.panelId];
            if (state) {
                Tweener.removeTweens(panel.actor);
            }
        });
    } else {
        Main.panelManager.panels.forEach(panel => {
            let state = panelStates[panel.panelId];
            if (state) {
                destroyIndicator(panel);
                Tweener.removeTweens(panel.actor);
                panel.actor.opacity = 255;
                panel.actor.show();
                state.isHidden = false;
            }
        });
    }
}

function updateMenuPositions() {
    if (isInEditMode) return;
    
    Main.panelManager.panels.forEach(panel => {
        if (shouldApplyToPanel(panel)) {
            cleanupTrackedMenus(panel);
            let state = panelStates[panel.panelId];
            if (state) {
                state.trackedMenus.forEach(menu => {
                    updateMenuPosition(panel, menu);
                });
            }
        }
    });
}

function updateMenuPosition(panel, menu) {
    if (isInEditMode || isTransitioningWorkspace) return true;
    
    let state = panelStates[panel.panelId];
    if (!state) return;
    
    let heightOffset = settings.getValue("height-offset");
    let adjustedOffset = state.location === "top" ? -heightOffset : heightOffset;
    
    Mainloop.timeout_add(1, function() {
        try {
            if (menu && !menu.is_finalized()) {
                menu.y = menu.y + adjustedOffset;
            }
        } catch(e) {
        }
        return false;
    });
}

function startSizeMonitoring() {
    sizeCheckTimeout = Mainloop.timeout_add(500, function() {
        if (isInEditMode || isTransitioningWorkspace) return true;
        
        Main.panelManager.panels.forEach(panel => {
            if (shouldApplyToPanel(panel)) {
                let state = panelStates[panel.panelId];
                if (state && !state.isHidden) {
                    checkAndApplyStyle(panel, true);
                }
            }
        });
        return true;
    });
}

function checkAndApplyStyle(panel, forceApply) {
    if (isInEditMode && !forceApply) return;
    
    let state = panelStates[panel.panelId];
    if (!state) return;
    
    if (!forceApply && (panel._editMode || (panel.peekDesktop && panel.peekDesktop._editMode))) {
        return;
    }
    
    [panel._leftBox, panel._centerBox, panel._rightBox].forEach(box => {
        box.get_children().forEach(child => {
            if (child._applet && child._applet._updateApplet) {
                child._applet._updateApplet();
            }
            if (child._applet && child._applet.on_panel_height_changed) {
                child._applet.on_panel_height_changed();
            }
            if (child.actor) {
                child.actor.queue_relayout();
            }
        });
    });
    
    let [minWidth, leftWidth] = panel._leftBox.get_preferred_width(-1);
    let [minWidth2, centerWidth] = panel._centerBox.get_preferred_width(-1);
    let [minWidth3, rightWidth] = panel._rightBox.get_preferred_width(-1);
    
    let contentWidth = leftWidth + centerWidth + rightWidth;
    
    let panelPadding = 20;
    let newWidth = Math.max(contentWidth + (panelPadding * 2), 200);

    if (newWidth !== state.lastWidth || forceApply) {
        state.lastWidth = newWidth;
        applyStyle(panel, forceApply);
        
        if (state.indicator && settings.getValue("show-indicator")) {
            updateIndicator(panel);
        }
    }
}

function applyStyle(panel, forceApply) {
    if (isInEditMode && !forceApply) return;
    
    let state = panelStates[panel.panelId];
    if (!state) return;
    
    let transparency = settings.getValue("transparency") / 100.0;
    let heightOffset = settings.getValue("height-offset");
    let adjustedOffset = state.location === "top" ? -heightOffset : heightOffset;
    let monitor = getMonitorGeometry(panel);
    
    let margin = (monitor.width - state.lastWidth) / 2;
    let panelPadding = 20;
    
    let savedOpacity = state.isHidden ? 0 : panel.actor.opacity;
    
    panel.actor.set_style(
        'background-color: rgba(30, 30, 30, ' + transparency + ');' +
        'border-radius: 12px;' +
        'padding: 0px ' + panelPadding + 'px;' +
        'margin-left: ' + margin + 'px;' +
        'margin-right: ' + margin + 'px;' +
        'box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);'
    );
    
    panel.actor.opacity = savedOpacity;
    panel.actor.y = state.originalY + adjustedOffset;
}

function applyStyleToAll() {
    if (isInEditMode) return;
    
    Main.panelManager.panels.forEach(panel => {
        if (shouldApplyToPanel(panel)) {
            applyStyle(panel);
        }
    });
}

function disable() {
    cleanupAllPanels();
    
    if (settings) {
        settings.finalize();
        settings = null;
    }
    
    settingsCallbacks = {};
}