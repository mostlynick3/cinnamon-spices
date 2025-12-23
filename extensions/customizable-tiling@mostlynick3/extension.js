const Main = imports.ui.main;
const Meta = imports.gi.Meta;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
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
let hasHitMinSize = false;
let minSnapWidth;
let minSnapHeight;
let windowDestroyIds = new Map();
let isHandlingResize = false;
let mousePollId;
let showSnapAssistant;
let snapAssistantContainer;
let snapAssistantActors = [];

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
    settings.bindProperty(Settings.BindingDirection.IN, "show-snap-assistant", "showSnapAssistant", onSettingsChanged);
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
    showSnapAssistant = settings.getValue("show-snap-assistant");
}

function enable() {
    onSettingsChanged();
    snappedPairs = [];

    grabOpBeginId = global.display.connect('grab-op-begin', onGrabBegin);
    grabOpEndId = global.display.connect('grab-op-end', onGrabEnd);
}

function onGrabBegin(display, screen, window, op) {
    if (op === Meta.GrabOp.MOVING && window.window_type === Meta.WindowType.NORMAL) {
        destroySnapAssistant();

        snappedPairs = snappedPairs.filter(pair =>
            pair.window1 !== window && pair.window2 !== window
        );

        currentWindow = window;
        lastSnapInfo = null;
        snapEnabled = false;
        windowMovedId = currentWindow.connect('position-changed', onWindowMoved);

        mousePollId = Mainloop.timeout_add(50, function() {
            if (currentWindow && snapEnabled) {
                onWindowMoved();
            }
            return true;
        });

        enableSnapTimeout = Mainloop.timeout_add(350, function() {
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

    let rect1 = pair.window1.get_frame_rect();
    let rect2 = pair.window2.get_frame_rect();
    let tolerance = 5;

    let sharesEdge = false;
    let correctOrientation = false;

    if (Math.abs((rect1.x + rect1.width) - rect2.x) <= tolerance &&
        rect1.y === rect2.y && rect1.height === rect2.height) {
        sharesEdge = true;
        correctOrientation = (pair.edge === 'left');
    } else if (Math.abs((rect2.x + rect2.width) - rect1.x) <= tolerance &&
               rect1.y === rect2.y && rect1.height === rect2.height) {
        sharesEdge = true;
        correctOrientation = (pair.edge === 'right');
    } else if (Math.abs((rect1.y + rect1.height) - rect2.y) <= tolerance &&
               rect1.x === rect2.x && rect1.width === rect2.width) {
        sharesEdge = true;
        correctOrientation = (pair.edge === 'top');
    } else if (Math.abs((rect2.y + rect2.height) - rect1.y) <= tolerance &&
               rect1.x === rect2.x && rect1.width === rect2.width) {
        sharesEdge = true;
        correctOrientation = (pair.edge === 'bottom');
    }

    if (!sharesEdge || !correctOrientation) {
        snappedPairs = snappedPairs.filter(p => p !== pair);
        return;
    }

	let otherWindow = pair.window1 === window ? pair.window2 : pair.window1;
	window.raise();
	otherWindow.raise();
	window.raise();

    resizeMonitorId = window.connect('size-changed', function() {
        handlePairedResize(window, pair, op, initialRect);
    });
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

        if (mousePollId) {
            Mainloop.source_remove(mousePollId);
            mousePollId = null;
        }

        if (snapEnabled) {
            let [x, y] = global.get_pointer();
            let monitor = Main.layoutManager.currentMonitor;

            if (monitor) {
                let snapInfo = getSnapInfo(x, y, monitor);
                if (snapInfo && window) {
                    performSnap(window, snapInfo, monitor);

                    if (showSnapAssistant && !snapInfo.maximize) {
                        let capturedWindow = window;
                        let capturedSnapInfo = snapInfo;
                        let capturedMonitor = monitor;

                        Mainloop.timeout_add(100, function() {
                            showSnapAssistantForWindow(capturedWindow, capturedSnapInfo, capturedMonitor);
                            return false;
                        });
                    }
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

        let pair = findPairForWindow(window);
        if (pair) {
            let otherWindow = pair.window1 === window ? pair.window2 : pair.window1;
            if (otherWindow) {
                otherWindow.get_compositor_private().queue_redraw();
            }
            window.get_compositor_private().queue_redraw();
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
    let workArea = global.screen.get_active_workspace().get_work_area_for_monitor(monitor.index);

    for (let win of windows) {
        if (Math.abs(x - (win.x + win.width)) <= threshold &&
            y >= win.y && y <= win.y + win.height &&
            x > win.x + win.width) {
            if (isEdgeVisible(win, 'right', x, y, windows)) {
                let targetWidth = workArea.x + workArea.width - (win.x + win.width);
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
                let targetWidth = win.x - workArea.x;
                let targetHeight = win.height;
                if (targetWidth >= minWidth && targetHeight >= minHeight) {
                    return {
                        x: workArea.x,
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
                let targetHeight = workArea.y + workArea.height - (win.y + win.height);
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
                let targetHeight = win.y - workArea.y;
                if (targetWidth >= minWidth && targetHeight >= minHeight) {
                    return {
                        x: win.x,
                        y: workArea.y,
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
    let workArea = global.screen.get_active_workspace().get_work_area_for_monitor(monitor.index);

    let relX = x - workArea.x;
    let relY = y - workArea.y;

    if (relY <= threshold && relX >= workArea.width / 3 && relX <= 2 * workArea.width / 3) {
        return {
            maximize: true
        };
    }

    let cols = gridColumns || 2;
    let rows = gridRows || 2;

    let colWidth = workArea.width / cols;
    let rowHeight = workArea.height / rows;

    if (relX <= threshold && relY <= threshold) {
        return { col: 0, row: 0, colSpan: 1, rowSpan: 1 };
    }
    if (relX >= workArea.width - threshold && relY <= threshold) {
        return { col: cols - 1, row: 0, colSpan: 1, rowSpan: 1 };
    }
    if (relX <= threshold && relY >= workArea.height - threshold) {
        return { col: 0, row: rows - 1, colSpan: 1, rowSpan: 1 };
    }
    if (relX >= workArea.width - threshold && relY >= workArea.height - threshold) {
        return { col: cols - 1, row: rows - 1, colSpan: 1, rowSpan: 1 };
    }

    let snapCol = -1;
    let snapRow = -1;

    if (relX <= threshold) {
        snapCol = 0;
    } else if (relX >= workArea.width - threshold) {
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
    } else if (relY >= workArea.height - threshold) {
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
    let workArea = global.screen.get_active_workspace().get_work_area_for_monitor(monitor.index);

    if (snapInfo.maximize) {
        rect = {
            x: workArea.x,
            y: workArea.y,
            width: workArea.width,
            height: workArea.height
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
    let workArea = global.screen.get_active_workspace().get_work_area_for_monitor(monitor.index);

    let colWidth = workArea.width / cols;
    let rowHeight = workArea.height / rows;

    return {
        x: workArea.x + Math.floor(snapInfo.col * colWidth),
        y: workArea.y + Math.floor(snapInfo.row * rowHeight),
        width: Math.floor(snapInfo.colSpan * colWidth),
        height: Math.floor(snapInfo.rowSpan * rowHeight)
    };
}

function performSnap(window, snapInfo, monitor) {
    let workArea = global.screen.get_active_workspace().get_work_area_for_monitor(monitor.index);

    if (snapInfo.maximize) {
        try {
            window.maximize(Meta.MaximizeFlags.BOTH);
        } catch(e) {
            return;
        }
        return;
    }

    let rect;

    if (snapInfo.intelligent) {
        rect = snapInfo;

        snappedPairs = snappedPairs.filter(pair =>
            pair.window1 !== window && pair.window2 !== window
        );

        if (snapInfo.snapWindow) {
            try {
                let otherRect = snapInfo.snapWindow.get_frame_rect();
                let pair = {
                    window1: window,
                    window2: snapInfo.snapWindow,
                    edge: snapInfo.edge,
                    rect1: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                    rect2: { x: otherRect.x, y: otherRect.y, width: otherRect.width, height: otherRect.height }
                };
                snappedPairs.push(pair);
                
                // Connect to unmanaged signal to cleanup pair
                let destroyId1 = window.connect('unmanaged', function() {
                    snappedPairs = snappedPairs.filter(p => p !== pair);
                    cleanupWindowDestroyHandler(window);
                });
                windowDestroyIds.set(window, destroyId1);
                
                let destroyId2 = snapInfo.snapWindow.connect('unmanaged', function() {
                    snappedPairs = snappedPairs.filter(p => p !== pair);
                    cleanupWindowDestroyHandler(snapInfo.snapWindow);
                });
                windowDestroyIds.set(snapInfo.snapWindow, destroyId2);
            } catch(e) {
                // snapWindow no longer valid
            }
        }
    } else {
        rect = getSnapRect(snapInfo, monitor);

        snappedPairs = snappedPairs.filter(pair =>
            pair.window1 !== window && pair.window2 !== window
        );

        let adjacentWindow = findAdjacentSnappedWindow(window, snapInfo, monitor);
        if (adjacentWindow) {
            try {
                let otherRect = adjacentWindow.window.get_frame_rect();
                let pair = {
                    window1: window,
                    window2: adjacentWindow.window,
                    edge: adjacentWindow.edge,
                    rect1: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                    rect2: { x: otherRect.x, y: otherRect.y, width: otherRect.width, height: otherRect.height }
                };
                snappedPairs.push(pair);
                
                // Connect to unmanaged signal to cleanup pair
                let destroyId1 = window.connect('unmanaged', function() {
                    snappedPairs = snappedPairs.filter(p => p !== pair);
                    cleanupWindowDestroyHandler(window);
                });
                windowDestroyIds.set(window, destroyId1);
                
                let destroyId2 = adjacentWindow.window.connect('unmanaged', function() {
                    snappedPairs = snappedPairs.filter(p => p !== pair);
                    cleanupWindowDestroyHandler(adjacentWindow.window);
                });
                windowDestroyIds.set(adjacentWindow.window, destroyId2);
            } catch(e) {
                // adjacentWindow no longer valid
            }
        }
    }

    if (rect.width === workArea.width && rect.height === workArea.height) {
        try {
            window.maximize(Meta.MaximizeFlags.BOTH);
        } catch(e) {
            return;
        }
        return;
    }

    try {
        window.unmaximize(Meta.MaximizeFlags.BOTH);
        window.move_resize_frame(false, rect.x, rect.y, rect.width, rect.height);
    } catch(e) {
        // Window no longer valid
        return;
    }
}

function cleanupWindowDestroyHandler(window) {
    if (windowDestroyIds.has(window)) {
        try {
            window.disconnect(windowDestroyIds.get(window));
        } catch(e) {
            // Already disconnected
        }
        windowDestroyIds.delete(window);
    }
}

function handlePairedResize(window, pair, op, initialRect) {
    if (isHandlingResize) {
        return;
    }
    isHandlingResize = true;

    try {
        let otherWindow = pair.window1 === window ? pair.window2 : pair.window1;

        if (!otherWindow) {
            snappedPairs = snappedPairs.filter(p => p !== pair);
            return;
        }

        let otherWindowId;
        try {
            otherWindowId = otherWindow.get_stable_sequence();
        } catch(e) {
            snappedPairs = snappedPairs.filter(p => p !== pair);
            return;
        }

        let newRect;
        try {
            newRect = window.get_frame_rect();
        } catch(e) {
            snappedPairs = snappedPairs.filter(p => p !== pair);
            return;
        }

        let monitor = window.get_monitor();
        let workspace = global.screen.get_active_workspace();
        let allWindows = workspace.list_windows();

        let expectedOtherRect = pair.window1 === window ? pair.rect2 : pair.rect1;

        let foundWindow = null;
        let otherRect;
        let tolerance = 10;

        for (let win of allWindows) {
            if (win.window_type !== Meta.WindowType.NORMAL ||
                win.minimized ||
                win.get_monitor() !== monitor) {
                continue;
            }

            let winId;
            try {
                winId = win.get_stable_sequence();
            } catch(e) {
                continue;
            }

            if (winId !== otherWindowId) {
                continue;
            }

            let winRect;
            try {
                winRect = win.get_frame_rect();
            } catch(e) {
                continue;
            }

            if (Math.abs(winRect.x - expectedOtherRect.x) <= tolerance &&
                Math.abs(winRect.y - expectedOtherRect.y) <= tolerance &&
                Math.abs(winRect.width - expectedOtherRect.width) <= tolerance &&
                Math.abs(winRect.height - expectedOtherRect.height) <= tolerance) {
                foundWindow = win;
                otherRect = winRect;
                break;
            }
        }

        if (!foundWindow) {
            snappedPairs = snappedPairs.filter(p => p !== pair);
            return;
        }

        let effectiveEdge = pair.edge;
        if (pair.window2 === window) {
            if (pair.edge === 'right') effectiveEdge = 'left';
            else if (pair.edge === 'left') effectiveEdge = 'right';
            else if (pair.edge === 'top') effectiveEdge = 'bottom';
            else if (pair.edge === 'bottom') effectiveEdge = 'top';
        }

        let beforeOtherRect = { x: otherRect.x, y: otherRect.y, width: otherRect.width, height: otherRect.height };
        let beforeWindowRect = { x: newRect.x, y: newRect.y, width: newRect.width, height: newRect.height };

        if (effectiveEdge === 'right') {
            if (op === Meta.GrabOp.RESIZING_W || op === Meta.GrabOp.RESIZING_NW || op === Meta.GrabOp.RESIZING_SW) {
                let targetEdge = newRect.x;
                let newOtherWidth = targetEdge - otherRect.x;

                try {
                    foundWindow.get_frame_rect();
                    foundWindow.move_resize_frame(false, otherRect.x, otherRect.y, newOtherWidth, otherRect.height);
                    
                    let afterOtherRect = foundWindow.get_frame_rect();
                    
                    // Check if other window actually changed
                    if (Math.abs(afterOtherRect.width - beforeOtherRect.width) < 2) {
                        // Other window didn't resize, revert focused window
                        window.move_resize_frame(false, initialRect.x, initialRect.y, initialRect.width, initialRect.height);
                        snappedPairs = snappedPairs.filter(p => p !== pair);
                        return;
                    }
                    
                    if (pair.window1 === window) {
                        pair.rect1 = { x: newRect.x, y: newRect.y, width: newRect.width, height: newRect.height };
                        pair.rect2 = { x: afterOtherRect.x, y: afterOtherRect.y, width: afterOtherRect.width, height: afterOtherRect.height };
                    } else {
                        pair.rect2 = { x: newRect.x, y: newRect.y, width: newRect.width, height: newRect.height };
                        pair.rect1 = { x: afterOtherRect.x, y: afterOtherRect.y, width: afterOtherRect.width, height: afterOtherRect.height };
                    }
                } catch(e) {
                    snappedPairs = snappedPairs.filter(p => p !== pair);
                    return;
                }
            }
        } else if (effectiveEdge === 'left') {
            if (op === Meta.GrabOp.RESIZING_E || op === Meta.GrabOp.RESIZING_NE || op === Meta.GrabOp.RESIZING_SE) {
                let targetEdge = newRect.x + newRect.width;
                let newOtherWidth = (otherRect.x + otherRect.width) - targetEdge;

                try {
                    foundWindow.get_frame_rect();
                    foundWindow.move_resize_frame(false, targetEdge, otherRect.y, newOtherWidth, otherRect.height);
                    
                    let afterOtherRect = foundWindow.get_frame_rect();
                    
                    if (Math.abs(afterOtherRect.width - beforeOtherRect.width) < 2) {
                        window.move_resize_frame(false, initialRect.x, initialRect.y, initialRect.width, initialRect.height);
                        snappedPairs = snappedPairs.filter(p => p !== pair);
                        return;
                    }
                    
                    if (pair.window1 === window) {
                        pair.rect1 = { x: newRect.x, y: newRect.y, width: newRect.width, height: newRect.height };
                        pair.rect2 = { x: afterOtherRect.x, y: afterOtherRect.y, width: afterOtherRect.width, height: afterOtherRect.height };
                    } else {
                        pair.rect2 = { x: newRect.x, y: newRect.y, width: newRect.width, height: newRect.height };
                        pair.rect1 = { x: afterOtherRect.x, y: afterOtherRect.y, width: afterOtherRect.width, height: afterOtherRect.height };
                    }
                } catch(e) {
                    snappedPairs = snappedPairs.filter(p => p !== pair);
                    return;
                }
            }
        } else if (effectiveEdge === 'bottom') {
            if (op === Meta.GrabOp.RESIZING_N || op === Meta.GrabOp.RESIZING_NW || op === Meta.GrabOp.RESIZING_NE) {
                let targetEdge = newRect.y;
                let newOtherHeight = targetEdge - otherRect.y;

                try {
                    foundWindow.get_frame_rect();
                    foundWindow.move_resize_frame(false, otherRect.x, otherRect.y, otherRect.width, newOtherHeight);
                    
                    let afterOtherRect = foundWindow.get_frame_rect();
                    
                    if (Math.abs(afterOtherRect.height - beforeOtherRect.height) < 2) {
                        window.move_resize_frame(false, initialRect.x, initialRect.y, initialRect.width, initialRect.height);
                        snappedPairs = snappedPairs.filter(p => p !== pair);
                        return;
                    }
                    
                    if (pair.window1 === window) {
                        pair.rect1 = { x: newRect.x, y: newRect.y, width: newRect.width, height: newRect.height };
                        pair.rect2 = { x: afterOtherRect.x, y: afterOtherRect.y, width: afterOtherRect.width, height: afterOtherRect.height };
                    } else {
                        pair.rect2 = { x: newRect.x, y: newRect.y, width: newRect.width, height: newRect.height };
                        pair.rect1 = { x: afterOtherRect.x, y: afterOtherRect.y, width: afterOtherRect.width, height: afterOtherRect.height };
                    }
                } catch(e) {
                    snappedPairs = snappedPairs.filter(p => p !== pair);
                    return;
                }
            }
        } else if (effectiveEdge === 'top') {
            if (op === Meta.GrabOp.RESIZING_S || op === Meta.GrabOp.RESIZING_SW || op === Meta.GrabOp.RESIZING_SE) {
                let targetEdge = newRect.y + newRect.height;
                let newOtherHeight = (otherRect.y + otherRect.height) - targetEdge;

                try {
                    foundWindow.get_frame_rect();
                    foundWindow.move_resize_frame(false, otherRect.x, targetEdge, otherRect.width, newOtherHeight);
                    
                    let afterOtherRect = foundWindow.get_frame_rect();
                    
                    if (Math.abs(afterOtherRect.height - beforeOtherRect.height) < 2) {
                        window.move_resize_frame(false, initialRect.x, initialRect.y, initialRect.width, initialRect.height);
                        snappedPairs = snappedPairs.filter(p => p !== pair);
                        return;
                    }
                    
                    if (pair.window1 === window) {
                        pair.rect1 = { x: newRect.x, y: newRect.y, width: newRect.width, height: newRect.height };
                        pair.rect2 = { x: afterOtherRect.x, y: afterOtherRect.y, width: afterOtherRect.width, height: afterOtherRect.height };
                    } else {
                        pair.rect2 = { x: newRect.x, y: newRect.y, width: newRect.width, height: newRect.height };
                        pair.rect1 = { x: afterOtherRect.x, y: afterOtherRect.y, width: afterOtherRect.width, height: afterOtherRect.height };
                    }
                } catch(e) {
                    snappedPairs = snappedPairs.filter(p => p !== pair);
                    return;
                }
            }
        }

        initialRect.x = newRect.x;
        initialRect.y = newRect.y;
        initialRect.width = newRect.width;
        initialRect.height = newRect.height;
    } finally {
        isHandlingResize = false;
    }
}
function findAdjacentSnappedWindow(window, snapInfo, monitor) {
    let cols = gridColumns || 2;
    let rows = gridRows || 2;

    let workspace = global.screen.get_active_workspace();
    let allWindows = workspace.list_windows();

    let rect = getSnapRect(snapInfo, monitor);
    let tolerance = 5;

    for (let win of allWindows) {
        if (win === window ||
            win.window_type !== Meta.WindowType.NORMAL ||
            win.minimized ||
            win.get_monitor() !== monitor.index) {
            continue;
        }

        let winRect = win.get_frame_rect();

        if (Math.abs(winRect.x + winRect.width - rect.x) <= tolerance &&
            winRect.y === rect.y && winRect.height === rect.height) {
            return { window: win, edge: 'right' };
        }

        if (Math.abs(rect.x + rect.width - winRect.x) <= tolerance &&
            winRect.y === rect.y && winRect.height === rect.height) {
            return { window: win, edge: 'left' };
        }

        if (Math.abs(winRect.y + winRect.height - rect.y) <= tolerance &&
            winRect.x === rect.x && winRect.width === rect.width) {
            return { window: win, edge: 'bottom' };
        }

        if (Math.abs(rect.y + rect.height - winRect.y) <= tolerance &&
            winRect.x === rect.x && winRect.width === rect.width) {
            return { window: win, edge: 'top' };
        }
    }

    return null;
}

function showSnapAssistantForWindow(window, snapInfo, monitor) {
    try {
        if (!window || !snapInfo || !monitor) {
            return;
        }

        let adjacentPositions = getAdjacentEmptyPositions(window, snapInfo, monitor);

        if (adjacentPositions.length === 0) {
            return;
        }

        let workspace = global.screen.get_active_workspace();
        let allWindows = workspace.list_windows();
        let availableWindows = allWindows.filter(win =>
            win !== window &&
            win.window_type === Meta.WindowType.NORMAL &&
            !win.minimized &&
            win.get_monitor() === monitor.index
        );

        if (availableWindows.length === 0) {
            return;
        }

        snapAssistantContainer = new St.Widget({
            reactive: true,
            track_hover: false,
            can_focus: true,
            x: 0,
            y: 0,
            width: global.screen_width,
            height: global.screen_height
        });

        snapAssistantContainer.set_style('background-color: rgba(0, 0, 0, 0);');

        Main.uiGroup.add_actor(snapAssistantContainer);

        if (!Main.pushModal(snapAssistantContainer)) {
            snapAssistantContainer.destroy();
            snapAssistantContainer = null;
            return;
        }

        snapAssistantContainer._modalPushed = true;

        snapAssistantContainer.grab_key_focus();

        let clickId = snapAssistantContainer.connect('button-press-event', function(actor, event) {
            let [x, y] = event.get_coords();

            for (let thumbActor of snapAssistantActors) {
                if (thumbActor instanceof St.Button) {
                    let [thumbX, thumbY] = thumbActor.get_transformed_position();
                    let thumbWidth = thumbActor.get_width();
                    let thumbHeight = thumbActor.get_height();

                    if (x >= thumbX && x <= thumbX + thumbWidth &&
                        y >= thumbY && y <= thumbY + thumbHeight) {
                        return Clutter.EVENT_PROPAGATE;
                    }
                }
            }

            destroySnapAssistant();
            return Clutter.EVENT_STOP;
        });
        snapAssistantContainer._clickId = clickId;

        let keyId = snapAssistantContainer.connect('key-press-event', function(actor, event) {
            destroySnapAssistant();
            return Clutter.EVENT_STOP;
        });
        snapAssistantContainer._keyId = keyId;

        for (let i = 0; i < adjacentPositions.length; i++) {
            let position = adjacentPositions[i];
            showWindowThumbnailsInSnapArea(position, availableWindows, monitor);
        }

    } catch(e) {
        destroySnapAssistant();
    }
}

function showWindowThumbnailsInSnapArea(position, windows, monitor) {
    let rect = position.rect;

    let snapAreaOverlay = new St.Widget({
        reactive: false,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
    });

	snapAreaOverlay.set_style(
		'background-color: ' + previewFill + ';' +
		'border: 3px solid ' + previewColor + ';' +
		'border-radius: 8px;'
	);

    snapAssistantContainer.add_actor(snapAreaOverlay);
    snapAssistantActors.push(snapAreaOverlay);

    let padding = 30;
    let thumbnailSpacing = 20;
    let maxThumbnailsPerRow = 3;

    let availableWidth = rect.width - (padding * 2);
    let availableHeight = rect.height - (padding * 2);

    let numWindows = Math.min(windows.length, 9);
    let numRows = Math.ceil(numWindows / maxThumbnailsPerRow);
    let numCols = Math.min(numWindows, maxThumbnailsPerRow);

    let thumbnailWidth = (availableWidth - (thumbnailSpacing * (numCols - 1))) / numCols;
    let thumbnailHeight = (availableHeight - (thumbnailSpacing * (numRows - 1))) / numRows;

    let maxThumbnailWidth = 350;
    let maxThumbnailHeight = 250;
    thumbnailWidth = Math.min(thumbnailWidth, maxThumbnailWidth);
    thumbnailHeight = Math.min(thumbnailHeight, maxThumbnailHeight);

    let containerWidth = (thumbnailWidth * numCols) + (thumbnailSpacing * (numCols - 1));
    let containerHeight = (thumbnailHeight * numRows) + (thumbnailSpacing * (numRows - 1));

    let startX = rect.x + (rect.width - containerWidth) / 2;
    let startY = rect.y + (rect.height - containerHeight) / 2;

    for (let i = 0; i < numWindows; i++) {
        let win = windows[i];
        let row = Math.floor(i / maxThumbnailsPerRow);
        let col = i % maxThumbnailsPerRow;

        let thumbX = startX + (col * (thumbnailWidth + thumbnailSpacing));
        let thumbY = startY + (row * (thumbnailHeight + thumbnailSpacing));

        createWindowThumbnail(win, thumbX, thumbY, thumbnailWidth, thumbnailHeight, position);
    }
}

function createWindowThumbnail(window, x, y, width, height, position) {
    let container = new St.Button({
        reactive: true,
        track_hover: true,
        x: x,
        y: y,
        width: width,
        height: height,
        style_class: 'window-thumbnail',
        clip_to_allocation: true
    });

    container.set_style(
        'background-color: ' + previewColor + ';' +
        'border: 3px solid ' + previewColor + ';' +
        'border-radius: 12px;' +
        'padding: 12px;'
    );

    let layout = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        y_expand: true
    });

    let thumbnailArea = new St.Bin({
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        y_expand: true
    });

	let windowActor = window.get_compositor_private();
	if (windowActor) {
		let windowRect = window.get_frame_rect();

		let scale = Math.min(
			(width - 24) / windowRect.width,
			(height - 24) / windowRect.height,
			0.3
		);

		let cloneContainer = new St.Widget({
			width: windowRect.width * scale,
			height: windowRect.height * scale,
			clip_to_allocation: true
		});

		let clone = new Clutter.Clone({
			source: windowActor,
			reactive: false,
			x: -(windowRect.width)*0.01, // For some reason, previews are skewed due right, this is a hackfix to reposition
			y: 0
		});

		clone.set_scale(scale, scale);
		cloneContainer.add_actor(clone);
		thumbnailArea.set_child(cloneContainer);
	}

    layout.add_child(thumbnailArea);
    container.set_child(layout);

    let maxLabelWidth = Math.floor(width * 0.65);

    let titleLabel = new St.Label({
        text: window.get_title() || 'Window',
        style: 'color: white; font-size: 14px; font-weight: bold; text-align: center;',
        x: x + (width - maxLabelWidth) / 2,
        y: y + height + 4,
        natural_width: maxLabelWidth
    });
    titleLabel.clutter_text.set_ellipsize(imports.gi.Pango.EllipsizeMode.END);
    titleLabel.clutter_text.set_line_wrap(false);
    titleLabel.clutter_text.set_single_line_mode(true);

    snapAssistantContainer.add_actor(titleLabel);
    snapAssistantActors.push(titleLabel);

    container.connect('enter-event', function() {
        container.set_style(
            'background-color: ' + lightenColor(previewColor, 20) + ';' +
            'border: 3px solid ' + lightenColor(previewColor, 20) + ';' +
            'border-radius: 12px;' +
            'padding: 12px;'
        );
    });

    container.connect('leave-event', function() {
        container.set_style(
            'background-color: ' + previewColor + ';' +
            'border: 3px solid ' + previewColor + ';' +
            'border-radius: 12px;' +
            'padding: 12px;'
        );
    });

    container.connect('clicked', function() {
        snapWindowToPosition(window, position);
        destroySnapAssistant();
        return Clutter.EVENT_STOP;
    });

    snapAssistantContainer.add_actor(container);
    snapAssistantActors.push(container);

    container.opacity = 0;
    titleLabel.opacity = 0;

    Tweener.addTween(container, {
        opacity: 255,
        time: 0.25,
        delay: 0.05 * snapAssistantActors.length,
        transition: 'easeOutQuad'
    });

    Tweener.addTween(titleLabel, {
        opacity: 255,
        time: 0.25,
        delay: 0.05 * snapAssistantActors.length,
        transition: 'easeOutQuad'
    });
}

function lightenColor(rgbaString, amount) {
    let match = rgbaString.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (!match) return rgbaString;

    let r = Math.min(255, parseInt(match[1]) + amount);
    let g = Math.min(255, parseInt(match[2]) + amount);
    let b = Math.min(255, parseInt(match[3]) + amount);
    let a = match[4] || 1;

    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function getAdjacentEmptyPositions(window, snapInfo, monitor) {
    try {
        let positions = [];
        let workArea = global.screen.get_active_workspace().get_work_area_for_monitor(monitor.index);
        let cols = gridColumns || 2;
        let rows = gridRows || 2;
        let windowRect = window.get_frame_rect();
        let tolerance = 10;

        if (snapInfo.intelligent) {
            let oppositeRect = getOppositeIntelligentRect(window, snapInfo, monitor);
            if (oppositeRect && !isGridPositionOccupied(oppositeRect, window, monitor)) {
                positions.push({
                    rect: oppositeRect,
                    snapInfo: {
                        intelligent: true,
                        x: oppositeRect.x,
                        y: oppositeRect.y,
                        width: oppositeRect.width,
                        height: oppositeRect.height
                    }
                });
            }
        } else {
            if (snapInfo.colSpan === cols && snapInfo.rowSpan < rows) {
                for (let r = 0; r < rows; r++) {
                    if (r !== snapInfo.row) {
                        let testSnapInfo = { col: 0, row: r, colSpan: cols, rowSpan: 1 };
                        let testRect = getSnapRect(testSnapInfo, monitor);
                        if (!isGridPositionOccupied(testRect, window, monitor)) {
                            positions.push({ rect: testRect, snapInfo: testSnapInfo });
                        }
                    }
                }
            }
            else if (snapInfo.rowSpan === rows && snapInfo.colSpan < cols) {
                for (let c = 0; c < cols; c++) {
                    if (c !== snapInfo.col) {
                        let testSnapInfo = { col: c, row: 0, colSpan: 1, rowSpan: rows };
                        let testRect = getSnapRect(testSnapInfo, monitor);
                        if (!isGridPositionOccupied(testRect, window, monitor)) {
                            positions.push({ rect: testRect, snapInfo: testSnapInfo });
                        }
                    }
                }
            }
            else if (snapInfo.colSpan === 1 && snapInfo.rowSpan === 1) {
                for (let c = 0; c < cols; c++) {
                    for (let r = 0; r < rows; r++) {
                        if (c === snapInfo.col && r === snapInfo.row) continue;

                        let testSnapInfo = { col: c, row: r, colSpan: 1, rowSpan: 1 };
                        let testRect = getSnapRect(testSnapInfo, monitor);

                        if (!isGridPositionOccupied(testRect, window, monitor) &&
                            isAdjacentToWindow(testRect, windowRect, tolerance)) {
                            positions.push({ rect: testRect, snapInfo: testSnapInfo });
                        }
                    }
                }
            }
        }

        return positions;

    } catch(e) {
        return [];
    }
}

function isGridPositionOccupied(gridRect, excludeWindow, monitor) {
    let workspace = global.screen.get_active_workspace();
    let allWindows = workspace.list_windows();
    let tolerance = 10;

    for (let win of allWindows) {
        if (win === excludeWindow ||
            win.window_type !== Meta.WindowType.NORMAL ||
            win.minimized ||
            win.get_monitor() !== monitor.index) {
            continue;
        }

        let winRect = win.get_frame_rect();

        if (Math.abs(winRect.x - gridRect.x) <= tolerance &&
            Math.abs(winRect.y - gridRect.y) <= tolerance &&
            Math.abs(winRect.width - gridRect.width) <= tolerance &&
            Math.abs(winRect.height - gridRect.height) <= tolerance) {
            return true;
        }
    }

    return false;
}

function isAdjacentToWindow(rect, windowRect, tolerance) {
    let sharesVerticalEdge = (
        Math.abs(rect.x + rect.width - windowRect.x) <= tolerance ||
        Math.abs(windowRect.x + windowRect.width - rect.x) <= tolerance
    );

    let sharesHorizontalEdge = (
        Math.abs(rect.y + rect.height - windowRect.y) <= tolerance ||
        Math.abs(windowRect.y + windowRect.height - rect.y) <= tolerance
    );

    let verticalOverlap = !(
        rect.y + rect.height <= windowRect.y ||
        windowRect.y + windowRect.height <= rect.y
    );

    let horizontalOverlap = !(
        rect.x + rect.width <= windowRect.x ||
        windowRect.x + windowRect.width <= rect.x
    );

    return (sharesVerticalEdge && verticalOverlap) || (sharesHorizontalEdge && horizontalOverlap);
}

function getOppositeIntelligentRect(window, snapInfo, monitor) {
    let workArea = global.screen.get_active_workspace().get_work_area_for_monitor(monitor.index);
    let windowRect = window.get_frame_rect();

    if (snapInfo.edge === 'right') {
        return {
            x: workArea.x,
            y: windowRect.y,
            width: windowRect.x - workArea.x,
            height: windowRect.height
        };
    } else if (snapInfo.edge === 'left') {
        return {
            x: windowRect.x + windowRect.width,
            y: windowRect.y,
            width: (workArea.x + workArea.width) - (windowRect.x + windowRect.width),
            height: windowRect.height
        };
    } else if (snapInfo.edge === 'bottom') {
        return {
            x: windowRect.x,
            y: workArea.y,
            width: windowRect.width,
            height: windowRect.y - workArea.y
        };
    } else if (snapInfo.edge === 'top') {
        return {
            x: windowRect.x,
            y: windowRect.y + windowRect.height,
            width: windowRect.width,
            height: (workArea.y + workArea.height) - (windowRect.y + windowRect.height)
        };
    }

    return null;
}

function rectanglesOverlap(rect1, rect2) {
    return !(rect1.x + rect1.width <= rect2.x ||
             rect2.x + rect2.width <= rect1.x ||
             rect1.y + rect1.height <= rect2.y ||
             rect2.y + rect2.height <= rect1.y);
}

function isAdjacent(rect1, rect2) {
    let tolerance = 5;

    if (Math.abs(rect1.x + rect1.width - rect2.x) <= tolerance ||
        Math.abs(rect2.x + rect2.width - rect1.x) <= tolerance) {
        return true;
    }

    if (Math.abs(rect1.y + rect1.height - rect2.y) <= tolerance ||
        Math.abs(rect2.y + rect2.height - rect1.y) <= tolerance) {
        return true;
    }

    return false;
}

function isPositionOccupied(rect, excludeWindow, monitor) {
    let workspace = global.screen.get_active_workspace();
    let allWindows = workspace.list_windows();

    for (let win of allWindows) {
        if (win === excludeWindow ||
            win.window_type !== Meta.WindowType.NORMAL ||
            win.minimized ||
            win.get_monitor() !== monitor.index) {
            continue;
        }

        let winRect = win.get_frame_rect();
        let overlapArea = getOverlapArea(rect, {
            x: winRect.x,
            y: winRect.y,
            width: winRect.width,
            height: winRect.height
        });

        let rectArea = rect.width * rect.height;
        if (overlapArea / rectArea > 0.5) {
            return true;
        }
    }

    return false;
}

function snapWindowToPosition(window, position) {
    let monitor = Main.layoutManager.currentMonitor;

    try {
        // Verify window still exists
        window.get_frame_rect();
        
        if (position.snapInfo.intelligent) {
            window.unmaximize(Meta.MaximizeFlags.BOTH);
            window.move_resize_frame(
                false,
                position.rect.x,
                position.rect.y,
                position.rect.width,
                position.rect.height
            );
        } else {
            performSnap(window, position.snapInfo, monitor);
        }

        window.activate(global.get_current_time());
    } catch(e) {
        // Window no longer valid, just return
        return;
    }
}

function destroySnapAssistant() {
    if (snapAssistantContainer) {
        if (snapAssistantContainer._clickId) {
            snapAssistantContainer.disconnect(snapAssistantContainer._clickId);
            snapAssistantContainer._clickId = null;
        }

        if (snapAssistantContainer._keyId) {
            snapAssistantContainer.disconnect(snapAssistantContainer._keyId);
            snapAssistantContainer._keyId = null;
        }

        if (snapAssistantContainer._modalPushed) {
            Main.popModal(snapAssistantContainer);
            snapAssistantContainer._modalPushed = false;
        }

        for (let actor of snapAssistantActors) {
            try {
                if (actor) {
                    Tweener.addTween(actor, {
                        opacity: 0,
                        time: 0.15,
                        transition: 'easeOutQuad'
                    });
                }
            } catch(e) {
            }
        }

        Mainloop.timeout_add(200, function() {
            if (snapAssistantContainer) {
                Main.uiGroup.remove_actor(snapAssistantContainer);
                snapAssistantContainer.destroy();
                snapAssistantContainer = null;
            }
            snapAssistantActors = [];
            return false;
        });
    } else {
        snapAssistantActors = [];
    }
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

    if (mousePollId) {
        Mainloop.source_remove(mousePollId);
        mousePollId = null;
    }

    destroyPreview(null);
    destroySnapAssistant();

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
