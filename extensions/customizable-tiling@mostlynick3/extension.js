const Main = imports.ui.main;
const Meta = imports.gi.Meta;
const St = imports.gi.St;
const Settings = imports.ui.settings;
const Tweener = imports.ui.tweener;
const Mainloop = imports.mainloop;

let previewColor;
let previewFill;
let gridColumns;
let gridRows;
let intelligentSpacing;
let virtualCorners;
let settings;
let preview;
let grabOpBeginId;
let grabOpEndId;
let windowMovedId;
let currentWindow;
let lastSnapInfo;
let snapEnabled;
let enableSnapTimeout;
let snappedPairs;
let resizeMonitorId;
let minSnapWidth;
let minSnapHeight;
let windowDestroyIds = new Map();

function init(metadata) {
    settings = new Settings.ExtensionSettings(this, metadata.uuid);
    settings.bindProperty(Settings.BindingDirection.IN, "snap-zone-width", "snapZoneWidth", null);
    settings.bindProperty(Settings.BindingDirection.IN, "preview-color", "previewColor", onSettingsChanged);
    settings.bindProperty(Settings.BindingDirection.IN, "preview-fill", "previewFill", onSettingsChanged);
    settings.bindProperty(Settings.BindingDirection.IN, "grid-columns", "gridColumns", onSettingsChanged);
    settings.bindProperty(Settings.BindingDirection.IN, "grid-rows", "gridRows", onSettingsChanged);
    settings.bindProperty(Settings.BindingDirection.IN, "intelligent-spacing", "intelligentSpacing", onSettingsChanged);
    settings.bindProperty(Settings.BindingDirection.IN, "virtual-corners", "virtualCorners", onSettingsChanged);
    settings.bindProperty(Settings.BindingDirection.IN, "min-snap-width", "minSnapWidth", onSettingsChanged);
    settings.bindProperty(Settings.BindingDirection.IN, "min-snap-height", "minSnapHeight", onSettingsChanged);
}

function onSettingsChanged() {
    previewColor = settings.getValue("preview-color");
    previewFill = settings.getValue("preview-fill");
    gridColumns = settings.getValue("grid-columns");
    gridRows = settings.getValue("grid-rows");
    intelligentSpacing = settings.getValue("intelligent-spacing");
    virtualCorners = settings.getValue("virtual-corners");
    minSnapWidth = settings.getValue("min-snap-width");
    minSnapHeight = settings.getValue("min-snap-height");
}

function enable() {
    onSettingsChanged();
    snappedPairs = [];
    
    grabOpBeginId = global.display.connect('grab-op-begin', onGrabBegin);
    grabOpEndId = global.display.connect('grab-op-end', onGrabEnd);
}

function onGrabBegin(display, screen, window, op) {
    if (op === Meta.GrabOp.MOVING && window.window_type === Meta.WindowType.NORMAL) {
        snappedPairs = snappedPairs.filter(pair => 
            pair.window1 !== window && pair.window2 !== window
        );
        
        currentWindow = window;
        lastSnapInfo = null;
        snapEnabled = false;
        windowMovedId = currentWindow.connect('position-changed', onWindowMoved);
        
        enableSnapTimeout = Mainloop.timeout_add(500, function() {
            if (!currentWindow) {
                enableSnapTimeout = null;
                return false;
            }
            
            snapEnabled = true;
            
            let [x, y] = global.get_pointer();
            let monitor = Main.layoutManager.currentMonitor;
            
            if (monitor) {
                let snapInfo = getSnapInfo(x, y, monitor);
                if (snapInfo) {
                    lastSnapInfo = snapInfo;
                    showPreview(snapInfo, monitor);
                }
            }
            
            enableSnapTimeout = null;
            return false;
        });
    } else if ((op === Meta.GrabOp.RESIZING_W || op === Meta.GrabOp.RESIZING_E || 
                op === Meta.GrabOp.RESIZING_N || op === Meta.GrabOp.RESIZING_S ||
                op === Meta.GrabOp.RESIZING_NW || op === Meta.GrabOp.RESIZING_NE ||
                op === Meta.GrabOp.RESIZING_SW || op === Meta.GrabOp.RESIZING_SE) && 
               window.window_type === Meta.WindowType.NORMAL) {
        startResizeMonitor(window, op);
    }
}

function startResizeMonitor(window, op) {
    let initialRect = window.get_frame_rect();
    let pair = findPairForWindow(window);
    
    if (!pair) return;
    
    resizeMonitorId = window.connect('size-changed', function() {
        handlePairedResize(window, pair, op, initialRect);
    });
}

function handlePairedResize(window, pair, op, initialRect) {
    let newRect = window.get_frame_rect();
    let otherWindow = pair.window1 === window ? pair.window2 : pair.window1;
    let otherRect = otherWindow.get_frame_rect();
    
    let effectiveEdge = pair.edge;
    if (pair.window2 === window) {
        if (pair.edge === 'right') effectiveEdge = 'left';
        else if (pair.edge === 'left') effectiveEdge = 'right';
        else if (pair.edge === 'top') effectiveEdge = 'bottom';
        else if (pair.edge === 'bottom') effectiveEdge = 'top';
    }
    
    if (effectiveEdge === 'right') {
        if (op === Meta.GrabOp.RESIZING_W || op === Meta.GrabOp.RESIZING_NW || op === Meta.GrabOp.RESIZING_SW) {
            let targetEdge = newRect.x;
            let newOtherWidth = targetEdge - otherRect.x;
            otherWindow.move_resize_frame(false, otherRect.x, otherRect.y, newOtherWidth, otherRect.height);
            
            let actualOtherRect = otherWindow.get_frame_rect();
            let actualEdge = actualOtherRect.x + actualOtherRect.width;
            if (actualEdge !== targetEdge) {
                window.move_resize_frame(false, actualEdge, newRect.y, newRect.width + (newRect.x - actualEdge), newRect.height);
            }
        }
    } else if (effectiveEdge === 'left') {
        if (op === Meta.GrabOp.RESIZING_E || op === Meta.GrabOp.RESIZING_NE || op === Meta.GrabOp.RESIZING_SE) {
            let targetEdge = newRect.x + newRect.width;
            let newOtherWidth = (otherRect.x + otherRect.width) - targetEdge;
            otherWindow.move_resize_frame(false, targetEdge, otherRect.y, newOtherWidth, otherRect.height);
            
            let actualOtherRect = otherWindow.get_frame_rect();
            let actualEdge = actualOtherRect.x;
            if (actualEdge !== targetEdge) {
                let newWidth = actualEdge - newRect.x;
                window.move_resize_frame(false, newRect.x, newRect.y, newWidth, newRect.height);
            }
        }
    } else if (effectiveEdge === 'bottom') {
        if (op === Meta.GrabOp.RESIZING_N || op === Meta.GrabOp.RESIZING_NW || op === Meta.GrabOp.RESIZING_NE) {
            let targetEdge = newRect.y;
            let newOtherHeight = targetEdge - otherRect.y;
            otherWindow.move_resize_frame(false, otherRect.x, otherRect.y, otherRect.width, newOtherHeight);
            
            let actualOtherRect = otherWindow.get_frame_rect();
            let actualEdge = actualOtherRect.y + actualOtherRect.height;
            if (actualEdge !== targetEdge) {
                window.move_resize_frame(false, newRect.x, actualEdge, newRect.width, newRect.height + (newRect.y - actualEdge));
            }
        }
    } else if (effectiveEdge === 'top') {
        if (op === Meta.GrabOp.RESIZING_S || op === Meta.GrabOp.RESIZING_SW || op === Meta.GrabOp.RESIZING_SE) {
            let targetEdge = newRect.y + newRect.height;
            let newOtherHeight = (otherRect.y + otherRect.height) - targetEdge;
            otherWindow.move_resize_frame(false, otherRect.x, targetEdge, otherRect.width, newOtherHeight);
            
            let actualOtherRect = otherWindow.get_frame_rect();
            let actualEdge = actualOtherRect.y;
            if (actualEdge !== targetEdge) {
                let newHeight = actualEdge - newRect.y;
                window.move_resize_frame(false, newRect.x, newRect.y, newRect.width, newHeight);
            }
        }
    }
    
    initialRect.x = newRect.x;
    initialRect.y = newRect.y;
    initialRect.width = newRect.width;
    initialRect.height = newRect.height;
}

function findPairForWindow(window) {
    for (let pair of snappedPairs) {
        if (pair.window1 === window || pair.window2 === window) {
            return pair;
        }
    }
    return null;
}

function onWindowMoved() {
    if (!currentWindow || !snapEnabled) return;
    
    let [x, y] = global.get_pointer();
    let monitor = Main.layoutManager.currentMonitor;
    
    if (!monitor) return;
    
    let snapInfo = getSnapInfo(x, y, monitor);
    
    if (snapInfo) {
        if (!snapInfoEquals(snapInfo, lastSnapInfo)) {
            lastSnapInfo = snapInfo;
            destroyPreview(function() {
                showPreview(snapInfo, monitor);
            });
        }
    } else {
        lastSnapInfo = null;
        destroyPreview(null);
    }
}

function onGrabEnd(display, screen, window, op) {
    if (op === Meta.GrabOp.MOVING && window.window_type === Meta.WindowType.NORMAL) {
        if (enableSnapTimeout) {
            Mainloop.source_remove(enableSnapTimeout);
            enableSnapTimeout = null;
        }
        
        if (snapEnabled) {
            let [x, y] = global.get_pointer();
            let monitor = Main.layoutManager.currentMonitor;
            
            if (monitor) {
                let snapInfo = getSnapInfo(x, y, monitor);
                if (snapInfo && currentWindow) {
                    performSnap(currentWindow, snapInfo, monitor);
                }
            }
        }
        
        destroyPreview(null);
        lastSnapInfo = null;
        snapEnabled = false;
        
        if (windowMovedId && currentWindow) {
            try {
                currentWindow.disconnect(windowMovedId);
            } catch(e) {
            }
            windowMovedId = null;
        }
        currentWindow = null;
    } else if ((op === Meta.GrabOp.RESIZING_W || op === Meta.GrabOp.RESIZING_E || 
                op === Meta.GrabOp.RESIZING_N || op === Meta.GrabOp.RESIZING_S ||
                op === Meta.GrabOp.RESIZING_NW || op === Meta.GrabOp.RESIZING_NE ||
                op === Meta.GrabOp.RESIZING_SW || op === Meta.GrabOp.RESIZING_SE) && 
               window.window_type === Meta.WindowType.NORMAL) {
        if (resizeMonitorId) {
            try {
                window.disconnect(resizeMonitorId);
            } catch(e) {
            }
            resizeMonitorId = null;
        }
    }
}

function snapInfoEquals(info1, info2) {
    if (!info1 || !info2) return false;
    
    if (info1.maximize && info2.maximize) return true;
    
    if (info1.intelligent && info2.intelligent) {
        return info1.x === info2.x && 
               info1.y === info2.y && 
               info1.width === info2.width && 
               info1.height === info2.height;
    }
    
    if (!info1.intelligent && !info2.intelligent) {
        return info1.col === info2.col && 
               info1.row === info2.row && 
               info1.colSpan === info2.colSpan && 
               info1.rowSpan === info2.rowSpan;
    }
    
    return false;
}

function getOverlapArea(rect1, rect2) {
    let x1 = Math.max(rect1.x, rect2.x);
    let y1 = Math.max(rect1.y, rect2.y);
    let x2 = Math.min(rect1.x + rect1.width, rect2.x + rect2.width);
    let y2 = Math.min(rect1.y + rect1.height, rect2.y + rect2.height);
    
    if (x2 <= x1 || y2 <= y1) {
        return 0;
    }
    
    return (x2 - x1) * (y2 - y1);
}

function isWindowObstructed(win, higherWindows) {
    let winRect = win.get_frame_rect();
    let winArea = {
        x: winRect.x,
        y: winRect.y,
        width: winRect.width,
        height: winRect.height
    };
    
    let totalWindowArea = winArea.width * winArea.height;
    let totalCoveredArea = 0;
    
    for (let higherWin of higherWindows) {
        let higherRect = higherWin.get_frame_rect();
        let higherArea = {
            x: higherRect.x,
            y: higherRect.y,
            width: higherRect.width,
            height: higherRect.height
        };
        
        let overlapArea = getOverlapArea(winArea, higherArea);
        totalCoveredArea += overlapArea;
    }
    
    return totalCoveredArea / totalWindowArea > 0.9;
}

function getWindowsOnMonitor(monitor) {
    let windows = [];
    let workspace = global.screen.get_active_workspace();
    let allWindows = workspace.list_windows();
    
    let stackedWindows = global.display.sort_windows_by_stacking(allWindows);
    
    for (let win of stackedWindows) {
        if (win && 
            win.window_type === Meta.WindowType.NORMAL &&
            win !== currentWindow &&
            !win.minimized &&
            win.get_monitor() === monitor.index) {
            
            let rect = win.get_frame_rect();
            windows.push({
                window: win,
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                stackIndex: stackedWindows.indexOf(win)
            });
        }
    }
    
    return windows;
}

function findIntelligentSnap(x, y, monitor) {
    let threshold = settings.getValue("snap-zone-width") || 30;
    let windows = getWindowsOnMonitor(monitor);
    let minWidth = minSnapWidth || 500;
    let minHeight = minSnapHeight || 350;
    
    for (let win of windows) {
        if (Math.abs(x - (win.x + win.width)) <= threshold &&
            y >= win.y && y <= win.y + win.height &&
            x > win.x + win.width) {
            if (isEdgeVisible(win, 'right', x, y, windows)) {
                let targetWidth = monitor.x + monitor.width - (win.x + win.width);
                let targetHeight = win.height;
                if (targetWidth >= minWidth && targetHeight >= minHeight) {
                    return {
                        x: win.x + win.width,
                        y: win.y,
                        width: targetWidth,
                        height: targetHeight,
                        intelligent: true,
                        snapWindow: win.window,
                        edge: 'right'
                    };
                }
            }
        }
        
        if (Math.abs(x - win.x) <= threshold &&
            y >= win.y && y <= win.y + win.height &&
            x < win.x) {
            if (isEdgeVisible(win, 'left', x, y, windows)) {
                let targetWidth = win.x - monitor.x;
                let targetHeight = win.height;
                if (targetWidth >= minWidth && targetHeight >= minHeight) {
                    return {
                        x: monitor.x,
                        y: win.y,
                        width: targetWidth,
                        height: targetHeight,
                        intelligent: true,
                        snapWindow: win.window,
                        edge: 'left'
                    };
                }
            }
        }
        
        if (Math.abs(y - (win.y + win.height)) <= threshold &&
            x >= win.x && x <= win.x + win.width &&
            y > win.y + win.height) {
            if (isEdgeVisible(win, 'bottom', x, y, windows)) {
                let targetWidth = win.width;
                let targetHeight = monitor.y + monitor.height - (win.y + win.height);
                if (targetWidth >= minWidth && targetHeight >= minHeight) {
                    return {
                        x: win.x,
                        y: win.y + win.height,
                        width: targetWidth,
                        height: targetHeight,
                        intelligent: true,
                        snapWindow: win.window,
                        edge: 'bottom'
                    };
                }
            }
        }
        
        if (Math.abs(y - win.y) <= threshold &&
            x >= win.x && x <= win.x + win.width &&
            y < win.y) {
            if (isEdgeVisible(win, 'top', x, y, windows)) {
                let targetWidth = win.width;
                let targetHeight = win.y - monitor.y;
                if (targetWidth >= minWidth && targetHeight >= minHeight) {
                    return {
                        x: win.x,
                        y: monitor.y,
                        width: targetWidth,
                        height: targetHeight,
                        intelligent: true,
                        snapWindow: win.window,
                        edge: 'top'
                    };
                }
            }
        }
    }
    
    return null;
}

function isEdgeVisible(win, edge, mouseX, mouseY, allWindows) {
    let winStackIndex = win.stackIndex;
    
    for (let other of allWindows) {
        if (other.window === win.window) continue;
        if (other.stackIndex <= winStackIndex) continue;
        
        if (edge === 'right') {
            let edgeX = win.x + win.width;
            if (other.x <= edgeX && other.x + other.width > edgeX &&
                mouseY >= other.y && mouseY < other.y + other.height) {
                return false;
            }
        } else if (edge === 'left') {
            let edgeX = win.x;
            if (other.x < edgeX && other.x + other.width >= edgeX &&
                mouseY >= other.y && mouseY < other.y + other.height) {
                return false;
            }
        } else if (edge === 'bottom') {
            let edgeY = win.y + win.height;
            if (other.y <= edgeY && other.y + other.height > edgeY &&
                mouseX >= other.x && mouseX < other.x + other.width) {
                return false;
            }
        } else if (edge === 'top') {
            let edgeY = win.y;
            if (other.y < edgeY && other.y + other.height >= edgeY &&
                mouseX >= other.x && mouseX < other.x + other.width) {
                return false;
            }
        }
    }
    
    return true;
}

function getSnapInfo(x, y, monitor) {
    let threshold = settings.getValue("snap-zone-width") || 30;
    
    let relX = x - monitor.x;
    let relY = y - monitor.y;
    
    if (relY <= threshold && relX >= monitor.width / 3 && relX <= 2 * monitor.width / 3) {
        return {
            maximize: true
        };
    }
    
    let cols = gridColumns || 2;
    let rows = gridRows || 2;
    
    let colWidth = monitor.width / cols;
    let rowHeight = monitor.height / rows;
    
    let snapCol = -1;
    let snapRow = -1;
    
    if (relX <= threshold) {
        snapCol = 0;
    } else if (relX >= monitor.width - threshold) {
        snapCol = cols - 1;
    } else if (virtualCorners) {
        for (let i = 1; i < cols; i++) {
            let dividerX = i * colWidth;
            if (Math.abs(relX - dividerX) <= threshold) {
                snapCol = Math.floor(relX / colWidth);
                break;
            }
        }
    }
    
    if (relY <= threshold) {
        snapRow = 0;
    } else if (relY >= monitor.height - threshold) {
        snapRow = rows - 1;
    } else if (virtualCorners) {
        for (let i = 1; i < rows; i++) {
            let dividerY = i * rowHeight;
            if (Math.abs(relY - dividerY) <= threshold) {
                snapRow = Math.floor(relY / rowHeight);
                break;
            }
        }
    }
    
    if (snapCol !== -1 || snapRow !== -1) {
        let colSpan = 1;
        let rowSpan = 1;
        
        if (snapCol !== -1 && snapRow === -1) {
            snapRow = 0;
            rowSpan = rows;
        }
        
        if (snapRow !== -1 && snapCol === -1) {
            snapCol = 0;
            colSpan = cols;
        }
        
        return {
            col: snapCol,
            row: snapRow,
            colSpan: colSpan,
            rowSpan: rowSpan
        };
    }
    
    if (intelligentSpacing) {
        let intelligentSnap = findIntelligentSnap(x, y, monitor);
        if (intelligentSnap) {
            return intelligentSnap;
        }
    }
    
    return null;
}

function showPreview(snapInfo, monitor) {
    let rect;
    
    if (snapInfo.maximize) {
        rect = {
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height: monitor.height
        };
    } else if (snapInfo.intelligent) {
        rect = snapInfo;
    } else {
        rect = getSnapRect(snapInfo, monitor);
    }
    
    preview = new St.BoxLayout({
        style_class: 'tile-preview',
        visible: false,
        opacity: 0
    });
    Main.uiGroup.add_actor(preview);
    
    preview.set_position(rect.x, rect.y);
    preview.set_size(rect.width, rect.height);
    
    let borderColor = previewColor || 'rgba(0, 150, 255, 0.8)';
    let fillColor = previewFill || 'rgba(0, 150, 255, 0.2)';
    preview.set_style('border: 2px solid ' + borderColor + '; background-color: ' + fillColor + ';');
    
    preview.show();
    Tweener.addTween(preview, {
        opacity: 255,
        time: 0.15,
        transition: 'easeOutQuad'
    });
}

function destroyPreview(callback) {
    if (preview) {
        Tweener.addTween(preview, {
            opacity: 0,
            time: 0.1,
            transition: 'easeOutQuad',
            onComplete: function() {
                if (preview) {
                    Main.uiGroup.remove_actor(preview);
                    preview.destroy();
                    preview = null;
                }
                if (callback) {
                    callback();
                }
            }
        });
    } else {
        if (callback) {
            callback();
        }
    }
}

function getSnapRect(snapInfo, monitor) {
    let cols = gridColumns || 2;
    let rows = gridRows || 2;
    
    let colWidth = monitor.width / cols;
    let rowHeight = monitor.height / rows;
    
    return {
        x: monitor.x + Math.floor(snapInfo.col * colWidth),
        y: monitor.y + Math.floor(snapInfo.row * rowHeight),
        width: Math.floor(snapInfo.colSpan * colWidth),
        height: Math.floor(snapInfo.rowSpan * rowHeight)
    };
}

function performSnap(window, snapInfo, monitor) {
    if (snapInfo.maximize) {
        window.maximize(Meta.MaximizeFlags.BOTH);
        return;
    }
    
    let rect;
    
    if (snapInfo.intelligent) {
        rect = snapInfo;
        
        snappedPairs = snappedPairs.filter(pair => 
            pair.window1 !== window && pair.window2 !== window
        );
        
        if (snapInfo.snapWindow) {
            snappedPairs.push({
                window1: window,
                window2: snapInfo.snapWindow,
                edge: snapInfo.edge
            });
        }
    } else {
        rect = getSnapRect(snapInfo, monitor);
    }
    
    if (rect.width === monitor.width && rect.height === monitor.height) {
        window.maximize(Meta.MaximizeFlags.BOTH);
        return;
    }
    
    window.unmaximize(Meta.MaximizeFlags.BOTH);
    window.move_resize_frame(false, rect.x, rect.y, rect.width, rect.height);
}

function disable() {
    if (grabOpBeginId) {
        global.display.disconnect(grabOpBeginId);
        grabOpBeginId = null;
    }
    
    if (grabOpEndId) {
        global.display.disconnect(grabOpEndId);
        grabOpEndId = null;
    }
    
    if (windowMovedId && currentWindow) {
        try {
            currentWindow.disconnect(windowMovedId);
        } catch(e) {
        }
        windowMovedId = null;
    }
    
    if (resizeMonitorId) {
        resizeMonitorId = null;
    }
    
    if (enableSnapTimeout) {
        Mainloop.source_remove(enableSnapTimeout);
        enableSnapTimeout = null;
    }
    
    destroyPreview(null);
    
    windowDestroyIds.forEach((id, window) => {
        try {
            window.disconnect(id);
        } catch(e) {}
    });
    windowDestroyIds.clear();
    
    currentWindow = null;
    lastSnapInfo = null;
    snapEnabled = false;
    snappedPairs = [];
}


