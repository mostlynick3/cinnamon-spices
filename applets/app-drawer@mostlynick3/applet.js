const Applet = imports.ui.applet;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const Main = imports.ui.main;
const Settings = imports.ui.settings;
const Util = imports.misc.util;
const Tweener = imports.ui.tweener;
const Tooltips = imports.ui.tooltips;

function MyApplet(metadata, orientation, panel_height, instance_id) {
    this._init(metadata, orientation, panel_height, instance_id);
}

MyApplet.prototype = {
    __proto__: Applet.IconApplet.prototype,

    _init: function(metadata, orientation, panel_height, instance_id) {
        Applet.IconApplet.prototype._init.call(this, orientation, panel_height, instance_id);
        
        this.set_applet_icon_symbolic_name("open-menu-symbolic");
        this.set_applet_tooltip("App Drawer");
        
        this.metadata = metadata;
        this.settings = new Settings.AppletSettings(this, metadata.uuid, instance_id);
        this.settings.bind("navigationMode", "navigationMode", this._onSettingsChanged.bind(this));
        this.settings.bind("columns", "columns", this._onSettingsChanged.bind(this));
        this.settings.bind("rows", "rows", this._onSettingsChanged.bind(this));
        this.settings.bind("iconSize", "iconSize", this._onSettingsChanged.bind(this));
        this.settings.bind("padding", "padding", this._onSettingsChanged.bind(this));
        this.settings.bind("fontSize", "fontSize", this._onSettingsChanged.bind(this));
        
        this.settings.bind("enableMarquee", "enableMarquee", this._onSettingsChanged.bind(this));
        this.settings.bind("marqueeMode", "marqueeMode", this._onSettingsChanged.bind(this));
        this.settings.bind("marqueeDelay", "marqueeDelay", this._onSettingsChanged.bind(this));
        
        this.settings.bind("enableSearch", "enableSearch", this._onSettingsChanged.bind(this));
        this.settings.bind("enableFavorites", "enableFavorites", this._onSettingsChanged.bind(this));
        this.settings.bind("favoriteApps", "favoriteApps");

        this.settings.bind("bgColor", "bgColor", this._onSettingsChanged.bind(this));
        this.settings.bind("bgOpacity", "bgOpacity", this._onSettingsChanged.bind(this));
        this.settings.bind("containerColor", "containerColor", this._onSettingsChanged.bind(this));
        this.settings.bind("containerOpacity", "containerOpacity", this._onSettingsChanged.bind(this));
        this.settings.bind("boxColor", "boxColor", this._onSettingsChanged.bind(this));
        this.settings.bind("boxOpacity", "boxOpacity", this._onSettingsChanged.bind(this));
        this.settings.bind("boxHoverColor", "boxHoverColor", this._onSettingsChanged.bind(this));
        this.settings.bind("boxHoverOpacity", "boxHoverOpacity", this._onSettingsChanged.bind(this));
        
        this.settings.bind("enableAnimations", "enableAnimations");
        this.settings.bind("openAnimationType", "openAnimationType");
        this.settings.bind("closeAnimationType", "closeAnimationType");
        this.settings.bind("pageAnimationType", "pageAnimationType");
        this.settings.bind("animationDuration", "animationDuration");
        
        this.modal = null;
        this.blurBackground = null;
        this.apps = [];
        this.filteredApps = [];
        this.currentPage = 0;
        this.isAnimating = false;
        this.isSearchMode = false;
        this.searchEntry = null;
        this.scrollAdjustment = null;
        this.isFirstOpen = true;
        this.activeTooltip = null;
        this.tooltipTimeout = null;
        this.focusedRow = 0;
        this.focusedCol = 0;
        this.appButtons = [];
    },

    on_applet_clicked: function() {
        if (this.isAnimating) return;
        
        if (this.modal) {
            this._destroyModal();
        } else {
            this._showModal();
        }
    },

    _onSettingsChanged: function() {
        if (this.modal) {
            this._destroyModal();
            this._showModal();
        }
    },

    _rgbToRgba: function(color, opacity) {
        let match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (match) {
            let r = match[1];
            let g = match[2];
            let b = match[3];
            let a = opacity / 100;
            return `rgba(${r}, ${g}, ${b}, ${a})`;
        }
        return color;
    },

    _loadApps: function() {
        this.apps = [];
        let appSystem = Gio.AppInfo.get_all();
        
        for (let i = 0; i < appSystem.length; i++) {
            let app = appSystem[i];
            if (app.should_show()) {
                this.apps.push(app);
            }
        }
        
        this.apps.sort((a, b) => {
            if (this.enableFavorites && this.favoriteApps && Array.isArray(this.favoriteApps)) {
                let aIsFav = this.favoriteApps.indexOf(a.get_id()) !== -1;
                let bIsFav = this.favoriteApps.indexOf(b.get_id()) !== -1;
                if (aIsFav && !bIsFav) return -1;
                if (!aIsFav && bIsFav) return 1;
            }
            return a.get_display_name().toLowerCase().localeCompare(b.get_display_name().toLowerCase());
        });
        
        this.filteredApps = this.apps.slice();
    },

	_getMonitorGeometry: function() {
		let [mouseX, mouseY] = global.get_pointer();
		
		for (let i = 0; i < Main.layoutManager.monitors.length; i++) {
			let monitor = Main.layoutManager.monitors[i];
			if (mouseX >= monitor.x && mouseX < monitor.x + monitor.width &&
				mouseY >= monitor.y && mouseY < monitor.y + monitor.height) {
				return monitor;
			}
		}
		
		return Main.layoutManager.primaryMonitor;
	},

    _focusApp: function(row, col) {
        let index;
        if (this.navigationMode === 'buttons') {
            index = (row * this.columns) + col;
        } else if (this.navigationMode === 'scroll-vertical') {
            index = (row * this.columns) + col;
        } else {
            index = (col * this.rows) + row;
        }
        
        if (index >= 0 && index < this.appButtons.length) {
            this.appButtons.forEach(btn => btn.remove_style_pseudo_class('focus'));
            this.appButtons[index].add_style_pseudo_class('focus');
            this.focusedRow = row;
            this.focusedCol = col;
            
            if (this.scrollAdjustment && (this.navigationMode === 'scroll-vertical' || this.navigationMode === 'scroll-horizontal')) {
                let button = this.appButtons[index];
                
                imports.mainloop.timeout_add(10, () => {
                    if (!button || button.is_finalized()) return false;
                    
                    let boxSize = this.iconSize + 60;
                    let padding = this.padding;
                    
                    if (this.navigationMode === 'scroll-vertical') {
                        let buttonY = (row * (boxSize + padding * 2)) + padding;
                        let viewHeight = (boxSize + padding * 2) * this.rows;
                        let currentScroll = this.scrollAdjustment.value;
                        
                        if (buttonY < currentScroll) {
                            this.scrollAdjustment.value = buttonY;
                        } else if (buttonY + boxSize + padding * 2 > currentScroll + viewHeight) {
                            this.scrollAdjustment.value = buttonY + boxSize + padding * 2 - viewHeight;
                        }
                    } else {
                        let buttonX = (col * (boxSize + padding * 2)) + padding;
                        let viewWidth = (boxSize + padding * 2) * this.columns;
                        let currentScroll = this.scrollAdjustment.value;
                        
                        if (buttonX < currentScroll) {
                            this.scrollAdjustment.value = buttonX;
                        } else if (buttonX + boxSize + padding * 2 > currentScroll + viewWidth) {
                            this.scrollAdjustment.value = buttonX + boxSize + padding * 2 - viewWidth;
                        }
                    }
                    
                    return false;
                });
            }
        }
    },

    _navigateApps: function(direction) {
        let newRow = this.focusedRow;
        let newCol = this.focusedCol;
        let perPage = this.columns * this.rows;
        
        let maxRow, maxCol;
        if (this.navigationMode === 'scroll-horizontal') {
            maxRow = this.rows - 1;
            maxCol = Math.ceil(this.filteredApps.length / this.rows) - 1;
        } else if (this.navigationMode === 'scroll-vertical') {
            maxRow = Math.ceil(this.filteredApps.length / this.columns) - 1;
            maxCol = this.columns - 1;
        } else {
            let appsOnPage = Math.min(perPage, this.filteredApps.length - (this.currentPage * perPage));
            maxRow = Math.ceil(appsOnPage / this.columns) - 1;
            maxCol = appsOnPage > this.columns ? this.columns - 1 : appsOnPage - 1;
        }
        
        switch(direction) {
            case 'up':
                if (newRow > 0) {
                    newRow--;
                }
                break;
            case 'down':
                if (this.navigationMode === 'scroll-vertical') {
                    let targetIndex = ((newRow + 1) * this.columns) + newCol;
                    if (targetIndex < this.filteredApps.length) {
                        newRow++;
                    }
                } else if (this.navigationMode === 'scroll-horizontal') {
                    if (newRow < maxRow) {
                        newRow++;
                    }
                } else {
                    if (newRow < maxRow) {
                        newRow++;
                    }
                }
                break;
            case 'left':
                if (newCol > 0) {
                    newCol--;
                } else if (this.navigationMode === 'buttons' && this.currentPage > 0) {
                    this.currentPage--;
                    this._updateGrid();
                    this._focusApp(0, 0);
                    return;
                }
                break;
            case 'right':
                if (this.navigationMode === 'scroll-horizontal') {
                    let targetIndex = (newCol + 1) * this.rows + newRow;
                    if (targetIndex < this.filteredApps.length) {
                        newCol++;
                    }
                } else if (this.navigationMode === 'scroll-vertical') {
                    if (newCol < maxCol) {
                        newCol++;
                    }
                } else {
                    if (newCol < maxCol) {
                        newCol++;
                    } else if (this.navigationMode === 'buttons') {
                        let maxPage = Math.ceil(this.filteredApps.length / perPage) - 1;
                        if (this.currentPage < maxPage) {
                            this.currentPage++;
                            this._updateGrid();
                            this._focusApp(0, 0);
                            return;
                        }
                    }
                }
                break;
        }
        
        this._focusApp(newRow, newCol);
    },

    _showModal: function() {
        let isFirstOpen = this.apps.length === 0;
        
        this._loadApps();
        this.currentPage = 0;
        this.isSearchMode = false;
        
        let monitor = this._getMonitorGeometry();
        
        this._createBlurBackground(monitor);
        
        let bgColor = this._rgbToRgba(this.bgColor, this.bgOpacity);
        
        this.modal = new St.BoxLayout({
            style_class: 'app-drawer-overlay',
            vertical: true,
            reactive: true,
            style: 'background-color: ' + bgColor + ';'
        });
        
        this.modal.set_position(monitor.x, monitor.y);
        this.modal.set_size(monitor.width, monitor.height);
        
        let containerColor = this._rgbToRgba(this.containerColor, this.containerOpacity);
        
        let container = new St.BoxLayout({
            style_class: 'app-drawer-container',
            vertical: true,
            reactive: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
            style: 'background: ' + containerColor + '; border-radius: 16px; border: 1px solid rgba(255, 255, 255, 0.18); backdrop-filter: blur(40px); box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);'
        });
        
        container.connect('button-press-event', (actor, event) => {
            return Clutter.EVENT_STOP;
        });
        
        if (this.enableSearch) {
            let searchBox = new St.BoxLayout({
                x_align: Clutter.ActorAlign.CENTER,
                style: 'padding: 24px 24px 12px 24px;'
            });
            
            let searchIcon = new St.Icon({
                icon_name: 'edit-find-symbolic',
                icon_size: 16,
                style: 'margin-right: 8px;'
            });

            this.searchEntry = new St.Entry({
                track_hover: true,
                can_focus: false,
                style_class: 'app-drawer-search',
                style: 'width: 400px; padding: 12px 16px 12px 40px; border-radius: 8px; background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.2); color: white; font-size: 14px;'
            });

            this.searchEntry.set_primary_icon(searchIcon);
            
            this.searchClearButton = new St.Icon({
                icon_name: 'edit-clear-symbolic',
                icon_size: 16,
                style: 'color: rgba(255, 255, 255, 0.7); padding: 4px;',
                reactive: true,
                visible: false
            });
            
            this.searchEntry.set_secondary_icon(this.searchClearButton);
            
            this.searchClearButton.connect('button-press-event', () => {
                this._clearSearch();
                return Clutter.EVENT_STOP;
            });
            
            this.searchEntry.clutter_text.connect('text-changed', () => {
                this.searchClearButton.visible = this.searchEntry.get_text().length > 0;
                this._onSearchTextChanged();
            });
            
            searchBox.add_actor(this.searchEntry);
            container.add_actor(searchBox);
        }

        let boxSize = this.iconSize + 60;
        let viewWidth = (boxSize + this.padding * 2) * this.columns + this.padding * 2;
        let viewHeight = (boxSize + this.padding * 2) * this.rows + this.padding * 2;
        
        if (this.navigationMode === 'scroll-vertical') {
            let scrollView = new St.ScrollView({
                style: 'width: ' + viewWidth + 'px; height: ' + viewHeight + 'px;',
                hscrollbar_policy: St.PolicyType.NEVER,
                vscrollbar_policy: St.PolicyType.AUTOMATIC
            });
            
            this.gridContainer = new St.BoxLayout({
                vertical: true,
                style: 'width: ' + (viewWidth - 20) + 'px;'
            });
            
            scrollView.add_actor(this.gridContainer);
            this.scrollAdjustment = scrollView.vscroll.adjustment;
            
            container.add_actor(scrollView);
        } else if (this.navigationMode === 'scroll-horizontal') {
            let scrollView = new St.ScrollView({
                style: 'width: ' + viewWidth + 'px; height: ' + viewHeight + 'px;',
                hscrollbar_policy: St.PolicyType.AUTOMATIC,
                vscrollbar_policy: St.PolicyType.NEVER
            });
            
            this.gridContainer = new St.BoxLayout({
                vertical: false,
                style: 'height: ' + (viewHeight - 20) + 'px;'
            });
            
            scrollView.add_actor(this.gridContainer);
            this.scrollAdjustment = scrollView.hscroll.adjustment;
            
            container.add_actor(scrollView);
        } else {
            this.gridContainer = new St.Widget();
            container.add_actor(this.gridContainer);
            
            let navBox = new St.BoxLayout({
                x_align: Clutter.ActorAlign.CENTER,
                style: 'padding: 24px;'
            });
            
            this.prevButton = new St.Button({
                label: '←',
                style: 'padding: 16px 32px; margin: 0 16px; background: rgba(255, 255, 255, 0.1); border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.2);'
            });

            this.prevButton.connect('clicked', () => {
                this._navigateLeft();
            });

            this.nextButton = new St.Button({
                label: '→',
                style: 'padding: 16px 32px; margin: 0 16px; background: rgba(255, 255, 255, 0.1); border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.2);'
            });
            this.nextButton.connect('clicked', () => {
                this._navigateRight();
            });
            
            navBox.add_actor(this.prevButton);
            navBox.add_actor(this.nextButton);
            container.add_actor(navBox);
        }
        
        this.modal.add_actor(container);
        
        this.modal.connect('button-press-event', (actor, event) => {
            let button = event.get_button();
            
            if (button === 1) {
                if (event.get_source() === this.modal) {
                    this._destroyModal();
                    return Clutter.EVENT_STOP;
                }
            }
            
            if (this.navigationMode === 'buttons') {
                if (button === 8) {
                    this._navigateLeft();
                    return Clutter.EVENT_STOP;
                }
                
                if (button === 9) {
                    this._navigateRight();
                    return Clutter.EVENT_STOP;
                }
            }
            
            return Clutter.EVENT_PROPAGATE;
        });
        
        this.modal.connect('scroll-event', (actor, event) => {
            if (this.navigationMode === 'buttons' && !this.isSearchMode) {
                let direction = event.get_scroll_direction();
                if (direction === Clutter.ScrollDirection.UP || direction === Clutter.ScrollDirection.LEFT) {
                    this._navigateLeft();
                    return Clutter.EVENT_STOP;
                } else if (direction === Clutter.ScrollDirection.DOWN || direction === Clutter.ScrollDirection.RIGHT) {
                    this._navigateRight();
                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });
        
        this.modal.connect('key-press-event', (actor, event) => {
            let symbol = event.get_key_symbol();
            
            if (symbol === Clutter.KEY_Escape) {
                this._destroyModal();
                return Clutter.EVENT_STOP;
            }
            
            if (symbol === Clutter.KEY_Up) {
                this._navigateApps('up');
                return Clutter.EVENT_STOP;
            }
            if (symbol === Clutter.KEY_Down) {
                this._navigateApps('down');
                return Clutter.EVENT_STOP;
            }
            if (symbol === Clutter.KEY_Left) {
                this._navigateApps('left');
                return Clutter.EVENT_STOP;
            }
            if (symbol === Clutter.KEY_Right) {
                this._navigateApps('right');
                return Clutter.EVENT_STOP;
            }
            
            if (symbol === Clutter.KEY_BackSpace) {
                if (this.enableSearch && this.searchEntry) {
                    let currentText = this.searchEntry.get_text();
                    if (currentText.length > 0) {
                        this.searchEntry.set_text(currentText.slice(0, -1));
                    }
                }
                return Clutter.EVENT_STOP;
            }
            
            if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
                let index;
                if (this.navigationMode === 'buttons') {
                    index = (this.currentPage * this.columns * this.rows) + (this.focusedRow * this.columns) + this.focusedCol;
                } else if (this.navigationMode === 'scroll-vertical') {
                    index = (this.focusedRow * this.columns) + this.focusedCol;
                } else {
                    index = (this.focusedCol * this.rows) + this.focusedRow;
                }
                if (index >= 0 && index < this.appButtons.length) {
                    this.appButtons[index].emit('button-press-event', null);
                }
                return Clutter.EVENT_STOP;
            }
            
            if (this.enableSearch && this.searchEntry && !event.has_control_modifier()) {
                let unichar = String.fromCharCode(Clutter.keysym_to_unicode(symbol));
                if (unichar && unichar.match(/[\w\s!"#¤%&]/)) {
                    let currentText = this.searchEntry.get_text();
                    this.searchEntry.set_text(currentText + unichar);
                    return Clutter.EVENT_STOP;
                }
            }
            
            return Clutter.EVENT_PROPAGATE;
        });
        
        Main.pushModal(this.modal);
        global.stage.add_actor(this.modal);
        
        this._updateGrid();
        
        this._focusApp(0, 0);

        imports.mainloop.timeout_add(60, () => {
            if (this.modal) {
                this._focusApp(0, 0);
            }
            return false;
        });

        this.modal.opacity = 0;

        let delay = this.isFirstOpen ? 50 : 0;
        let isFirst = this.isFirstOpen;
        this.isFirstOpen = false;

        imports.mainloop.timeout_add(delay, () => {
            if (!this.modal) return false;
            
            if (isFirst) {
                Tweener.addTween(this.modal, {
                    opacity: 255,
                    time: this.animationDuration / 1000,
                    transition: 'easeOutQuad',
                    onComplete: () => {
                        if (this.enableAnimations) {
                            this._animateOpen(this.modal, container);
                        }
                    }
                });
            } else if (this.enableAnimations) {
                this._animateOpen(this.modal, container);
            } else {
                this.modal.opacity = 255;
            }
            return false;
        });
    },

    _safeDestroyGrid: function(grid) {
        if (!grid) return;
        try {
            grid.destroy();
        } catch(e) {}
    },

    _updateGrid: function() {
        this.appButtons = [];
        let oldGrid = this.grid;
        
        let boxSize = this.iconSize + 60;
        
        if (this.navigationMode === 'scroll-vertical') {
            this.grid = new St.Widget({
                layout_manager: new Clutter.GridLayout({
                    orientation: Clutter.Orientation.VERTICAL
                }),
                style: 'padding: ' + this.padding + 'px;'
            });
            
            let viewWidth = (boxSize + this.padding * 2) * this.columns;
            this.grid.set_width(viewWidth);
            
            let layout = this.grid.layout_manager;
            let col = 0;
            let row = 0;
            
            for (let i = 0; i < this.filteredApps.length; i++) {
                let app = this.filteredApps[i];
                let button = this._createAppButton(app, boxSize);
                layout.attach(button, col, row, 1, 1);
                
                col++;
                if (col >= this.columns) {
                    col = 0;
                    row++;
                }
            }
            
            this._safeDestroyGrid(oldGrid);
            this.gridContainer.add_actor(this.grid);
            
        } else if (this.navigationMode === 'scroll-horizontal') {
            this.grid = new St.Widget({
                layout_manager: new Clutter.GridLayout({
                    orientation: Clutter.Orientation.HORIZONTAL
                }),
                style: 'padding: ' + this.padding + 'px;'
            });
            
            let viewHeight = (boxSize + this.padding * 2) * this.rows;
            this.grid.set_height(viewHeight);
            
            let layout = this.grid.layout_manager;
            let col = 0;
            let row = 0;
            
            for (let i = 0; i < this.filteredApps.length; i++) {
                let app = this.filteredApps[i];
                let button = this._createAppButton(app, boxSize);
                layout.attach(button, col, row, 1, 1);
                
                row++;
                if (row >= this.rows) {
                    row = 0;
                    col++;
                }
            }
            
            this._safeDestroyGrid(oldGrid);
            this.gridContainer.add_actor(this.grid);
            
        } else {
            this.grid = new St.Widget({
                layout_manager: new Clutter.GridLayout({
                    orientation: Clutter.Orientation.VERTICAL
                }),
                style: 'padding: ' + this.padding + 'px;'
            });
            
            let totalWidth = (boxSize + this.padding * 2) * this.columns + this.padding * 2;
            let totalHeight = (boxSize + this.padding * 2) * this.rows + this.padding * 2;
            this.grid.set_width(totalWidth);
            this.grid.set_height(totalHeight);
            
            let layout = this.grid.layout_manager;
            let perPage = this.columns * this.rows;
            let start = this.currentPage * perPage;
            let end = Math.min(start + perPage, this.filteredApps.length);
            
            let col = 0;
            let row = 0;
            
            for (let i = start; i < end; i++) {
                let app = this.filteredApps[i];
                let button = this._createAppButton(app, boxSize);
                layout.attach(button, col, row, 1, 1);
                
                col++;
                if (col >= this.columns) {
                    col = 0;
                    row++;
                }
            }
            
            let maxPage = Math.ceil(this.filteredApps.length / perPage) - 1;
            
            if (this.isSearchMode) {
                this.prevButton.visible = false;
                this.nextButton.visible = false;
            } else {
                this.prevButton.visible = this.currentPage > 0;
                this.nextButton.visible = this.currentPage < maxPage;
            }
            
            if (this.enableAnimations && oldGrid) {
                this._animatePageTransition(oldGrid, this.grid);
            } else {
                this._safeDestroyGrid(oldGrid);
                this.gridContainer.add_actor(this.grid);
            }
        }
    },

    _navigateLeft: function() {
        if (this.isSearchMode || this.isAnimating) return;
        
        if (this.currentPage > 0) {
            this.currentPage--;
            this._updateGrid();
        }
    },

    _navigateRight: function() {
        if (this.isSearchMode || this.isAnimating) return;
        
        let maxPage = Math.ceil(this.filteredApps.length / (this.columns * this.rows)) - 1;
        if (this.currentPage < maxPage) {
            this.currentPage++;
            this._updateGrid();
        }
    },

    _onSearchTextChanged: function() {
        let searchText = this.searchEntry.get_text().toLowerCase().trim();
        
        if (searchText === '') {
            this._clearSearch();
            return;
        }
        
        this.isSearchMode = true;
        this.currentPage = 0;
        
        this.filteredApps = this.apps.filter(app => {
            let name = app.get_display_name().toLowerCase();
            let description = app.get_description();
            let descText = description ? description.toLowerCase() : '';
            
            return name.includes(searchText) || descText.includes(searchText);
        });
        
        this._updateGrid();
        this._focusApp(0, 0);
    },

    _clearSearch: function() {
        if (this.searchEntry) {
            this.searchEntry.set_text('');
        }
        this.isSearchMode = false;
        this.currentPage = 0;
        this.filteredApps = this.apps.slice();
        this._updateGrid();
        this._focusApp(0, 0);
    },

    _animateOpen: function(modal, container) {
        this.isAnimating = true;
        let duration = this.animationDuration / 1000;
        
        switch(this.openAnimationType) {
            case 'fade':
                container.set_scale(1.0, 1.0);
                container.translation_y = 0;
                container.opacity = 255;
                modal.opacity = 0;
                if (this.blurBackground) this.blurBackground.opacity = 0;
                
                Tweener.addTween(modal, {
                    opacity: 255,
                    time: duration,
                    transition: 'easeOutQuad',
                    onComplete: () => { this.isAnimating = false; }
                });
                if (this.blurBackground) {
                    Tweener.addTween(this.blurBackground, {
                        opacity: 255,
                        time: duration,
                        transition: 'easeOutQuad'
                    });
                }
                break;
                
            case 'scale':
                modal.opacity = 255;
                if (this.blurBackground) this.blurBackground.opacity = 255;
                container.translation_y = 0;
                container.set_scale(0.8, 0.8);
                container.opacity = 0;
                Tweener.addTween(container, {
                    scale_x: 1.0,
                    scale_y: 1.0,
                    opacity: 255,
                    time: duration,
                    transition: 'easeOutQuad',
                    onComplete: () => { this.isAnimating = false; }
                });
                break;
                
            case 'slide-up':
                modal.opacity = 255;
                if (this.blurBackground) this.blurBackground.opacity = 255;
                container.set_scale(1.0, 1.0);
                container.translation_y = 100;
                container.opacity = 0;
                Tweener.addTween(container, {
                    translation_y: 0,
                    opacity: 255,
                    time: duration,
                    transition: 'easeOutQuad',
                    onComplete: () => { this.isAnimating = false; }
                });
                break;
                
            case 'zoom':
                container.translation_y = 0;
                modal.opacity = 0;
                if (this.blurBackground) this.blurBackground.opacity = 0;
                container.set_scale(0.5, 0.5);
                container.opacity = 255;
                Tweener.addTween(modal, {
                    opacity: 255,
                    time: duration,
                    transition: 'easeOutQuad'
                });
                if (this.blurBackground) {
                    Tweener.addTween(this.blurBackground, {
                        opacity: 255,
                        time: duration,
                        transition: 'easeOutQuad'
                    });
                }
                Tweener.addTween(container, {
                    scale_x: 1.0,
                    scale_y: 1.0,
                    time: duration,
                    transition: 'easeOutCubic',
                    onComplete: () => { this.isAnimating = false; }
                });
                break;
                
            default:
                modal.opacity = 255;
                if (this.blurBackground) this.blurBackground.opacity = 255;
                container.opacity = 255;
                this.isAnimating = false;
        }
    },

    _animatePageTransition: function(oldGrid, newGrid) {
        this.isAnimating = true;
        let duration = this.animationDuration / 1000;
        
        this.gridContainer.add_actor(newGrid);
        
        switch(this.pageAnimationType) {
            case 'fade':
                newGrid.opacity = 0;
                Tweener.addTween(oldGrid, {
                    opacity: 0,
                    time: duration / 2,
                    transition: 'easeOutQuad',
                    onComplete: () => {
                        this._safeDestroyGrid(oldGrid);
                    }
                });
                Tweener.addTween(newGrid, {
                    opacity: 255,
                    time: duration / 2,
                    delay: duration / 2,
                    transition: 'easeInQuad',
                    onComplete: () => { this.isAnimating = false; }
                });
                break;
                
            case 'slide':
                let direction = this.prevButton.visible && !this.nextButton.visible ? -1 : 1;
                newGrid.translation_x = direction * 200;
                newGrid.opacity = 0;
                
                Tweener.addTween(oldGrid, {
                    translation_x: -direction * 200,
                    opacity: 0,
                    time: duration,
                    transition: 'easeInOutQuad',
                    onComplete: () => {
                        this._safeDestroyGrid(oldGrid);
                    }
                });
                Tweener.addTween(newGrid, {
                    translation_x: 0,
                    opacity: 255,
                    time: duration,
                    transition: 'easeInOutQuad',
                    onComplete: () => { this.isAnimating = false; }
                });
                break;
                
            case 'crossfade':
                newGrid.opacity = 0;
                Tweener.addTween(oldGrid, {
                    opacity: 0,
                    time: duration,
                    transition: 'easeInOutQuad',
                    onComplete: () => {
                        this._safeDestroyGrid(oldGrid);
                    }
                });
                Tweener.addTween(newGrid, {
                    opacity: 255,
                    time: duration,
                    transition: 'easeInOutQuad',
                    onComplete: () => { this.isAnimating = false; }
                });
                break;
                
            default:
                this._safeDestroyGrid(oldGrid);
                this.isAnimating = false;
        }
    },

    _createAppButton: function(app, boxSize) {
        let boxColor = this._rgbToRgba(this.boxColor, this.boxOpacity);
        let boxHoverColor = this._rgbToRgba(this.boxHoverColor, this.boxHoverOpacity);
        let spacing = Math.round(this.iconSize * 0.2);
        
        let box = new St.BoxLayout({
            style_class: 'app-drawer-item',
            vertical: true,
            reactive: true,
            track_hover: true,
            width: boxSize,
            height: boxSize,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.START,
            style: 'margin: ' + this.padding + 'px; background: ' + boxColor + '; border-radius: 12px; transition: all 0.2s; spacing: ' + spacing + 'px; padding-top: ' + Math.round(boxSize * 0.15) + 'px;'
        });
        
        let description = app.get_description();
        let tooltipText = app.get_display_name();
        if (description) {
            tooltipText += '\n' + description;
        }
        
        box.connect('enter-event', () => {
            box.set_style('margin: ' + this.padding + 'px; background: ' + boxHoverColor + '; border-radius: 12px; box-shadow: 0 4px 16px 0 rgba(0, 0, 0, 0.3); spacing: ' + spacing + 'px; padding-top: ' + Math.round(boxSize * 0.15) + 'px;');

            if (this.tooltipTimeout) {
                imports.mainloop.source_remove(this.tooltipTimeout);
            }
            
            this.tooltipTimeout = imports.mainloop.timeout_add(300, () => {
                this._showTooltip(tooltipText);
                this.tooltipTimeout = null;
                return false;
            });
        });
        
        box.connect('leave-event', () => {
            if (!box.has_style_pseudo_class('focus')) {
                box.set_style('margin: ' + this.padding + 'px; background: ' + boxColor + '; border-radius: 12px; spacing: ' + spacing + 'px; padding-top: ' + Math.round(boxSize * 0.15) + 'px;');
            }

            if (this.tooltipTimeout) {
                imports.mainloop.source_remove(this.tooltipTimeout);
                this.tooltipTimeout = null;
            }
            this._hideTooltip();
        });
        
        box.connect('motion-event', (actor, event) => {
            if (this.activeTooltip) {
                let [x, y] = event.get_coords();
                this.activeTooltip.set_position(x + 15, y + 15);
            }
            return Clutter.EVENT_PROPAGATE;
        });
        
        box.connect('style-changed', () => {
            if (box.has_style_pseudo_class('focus')) {
                box.set_style('margin: ' + this.padding + 'px; background: ' + boxHoverColor + '; border-radius: 12px; box-shadow: 0 4px 16px 0 rgba(0, 0, 0, 0.3); spacing: ' + spacing + 'px; padding-top: ' + Math.round(boxSize * 0.15) + 'px;');
            } else if (!box.hover) {
                box.set_style('margin: ' + this.padding + 'px; background: ' + boxColor + '; border-radius: 12px; spacing: ' + spacing + 'px; padding-top: ' + Math.round(boxSize * 0.15) + 'px;');
            }
        });
        
        let icon = app.get_icon();
        let iconActor = new St.Icon({
            gicon: icon,
            icon_size: this.iconSize,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER
        });
        
        let iconWrapper = new St.Widget({
            layout_manager: new Clutter.FixedLayout(),
            width: this.iconSize,
            height: this.iconSize,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true
        });
        
        iconWrapper.add_child(iconActor);
        
        if (this.enableFavorites) {
            if (!this.favoriteApps) this.favoriteApps = [];
            let isFavorite = this.favoriteApps.indexOf(app.get_id()) !== -1;
            
            let starButton = new St.Button({
                reactive: true,
                track_hover: true,
                style: 'padding: 2px; background: rgba(0, 0, 0, 0.7); border-radius: 10px;'
            });
            
            let starIcon = new St.Icon({
                icon_name: isFavorite ? 'starred-symbolic' : 'non-starred-symbolic',
                icon_size: 16,
                style: 'color: ' + (isFavorite ? '#FFD700' : 'rgba(255, 255, 255, 0.6)') + ';'
            });
            
            starButton.set_child(starIcon);
            starButton.connect('button-press-event', () => {
                this._toggleFavorite(app);
                return Clutter.EVENT_STOP;
            });
            
            starButton.set_position(this.iconSize - 20, 0);
            iconWrapper.add_child(starButton);
        }
        
        box.add_actor(iconWrapper);
        
        let labelHeight = Math.round(this.fontSize * 2.5);
        let appName = app.get_display_name();
        
        if (this.enableMarquee) {
            let labelContainer = new St.Widget({
                width: boxSize - 16,
                height: labelHeight,
                clip_to_allocation: true,
                x_align: Clutter.ActorAlign.CENTER
            });
            
            let label = new St.Label({
                text: appName,
                style: 'font-size: ' + this.fontSize + 'pt; color: rgba(255, 255, 255, 0.95); text-align: center;',
                y_align: Clutter.ActorAlign.START
            });
            label.clutter_text.set_line_wrap(false);
            label.clutter_text.set_ellipsize(0);
            
            labelContainer.add_child(label);
            box.add_actor(labelContainer);
            
            let scrollLoopId = null;
            let isHovered = false;
            
            imports.mainloop.timeout_add(10, () => {
                if (!label || label.is_finalized()) return false;
                
                let labelWidth = label.get_width();
                let containerWidth = labelContainer.width;
                
                if (labelWidth <= containerWidth) {
                    label.x = Math.round((containerWidth - labelWidth) / 2);
                } else {
                    label.x = 0;
                    
                    let startScrollLoop = () => {
                        if (!label || label.is_finalized() || !this.modal) {
                            if (scrollLoopId) {
                                imports.mainloop.source_remove(scrollLoopId);
                                scrollLoopId = null;
                            }
                            return;
                        }
                        
                        let scrollDistance = labelWidth - containerWidth + 20;
                        
                        scrollLoopId = imports.mainloop.timeout_add(this.marqueeDelay, () => {
                            if (!label || label.is_finalized() || !this.modal) {
                                scrollLoopId = null;
                                return false;
                            }
                            
                            if (this.marqueeMode === 'hover' && !isHovered) {
                                scrollLoopId = null;
                                startScrollLoop();
                                return false;
                            }
                            
                            Tweener.addTween(label, {
                                x: -scrollDistance,
                                time: scrollDistance / 30,
                                transition: 'linear',
                                onComplete: () => {
                                    if (!label || label.is_finalized() || !this.modal) {
                                        return;
                                    }
                                    
                                    scrollLoopId = imports.mainloop.timeout_add(1000, () => {
                                        if (!label || label.is_finalized() || !this.modal) {
                                            scrollLoopId = null;
                                            return false;
                                        }
                                        
                                        if (this.marqueeMode === 'hover' && !isHovered) {
                                            Tweener.removeTweens(label);
                                            label.x = 0;
                                            scrollLoopId = null;
                                            return false;
                                        }
                                        
                                        Tweener.addTween(label, {
                                            x: 0,
                                            time: scrollDistance / 30,
                                            transition: 'linear',
                                            onComplete: () => {
                                                startScrollLoop();
                                            }
                                        });
                                        
                                        scrollLoopId = null;
                                        return false;
                                    });
                                }
                            });
                            
                            scrollLoopId = null;
                            return false;
                        });
                    };
                    
                    if (this.marqueeMode === 'auto') {
                        startScrollLoop();
                    } else if (this.marqueeMode === 'hover') {
                        box.connect('enter-event', () => {
                            isHovered = true;
                            if (!scrollLoopId && label.x === 0) {
                                startScrollLoop();
                            }
                        });
                        
                        box.connect('leave-event', () => {
                            isHovered = false;
                            if (scrollLoopId) {
                                imports.mainloop.source_remove(scrollLoopId);
                                scrollLoopId = null;
                            }
                            Tweener.removeTweens(label);
                            Tweener.addTween(label, {
                                x: 0,
                                time: 0.2,
                                transition: 'easeOutQuad'
                            });
                        });
                    }
                }
                
                return false;
            });

        } else {
            let label = new St.Label({
                text: appName,
                style: 'font-size: ' + this.fontSize + 'pt; color: rgba(255, 255, 255, 0.95); text-align: center; padding-left: 8px; padding-right: 8px; height: ' + labelHeight + 'px;',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.START
            });
            label.clutter_text.set_line_wrap(false);
            label.clutter_text.set_ellipsize(3);
            label.clutter_text.set_line_alignment(2);
            
            box.add_actor(label);
        }
        
        box.connect('button-press-event', () => {
            this._hideTooltip();
            app.launch([], null);
            this._destroyModal();
            return Clutter.EVENT_STOP;
        });
        
        this.appButtons.push(box);
        
        return box;
    },

    _showTooltip: function(text) {
        this._hideTooltip();
        
        let lines = text.split('\n');
        let styledText = '<span weight="bold">' + lines[0] + '</span>';
        if (lines.length > 1) {
            styledText += '\n' + lines.slice(1).join('\n');
        }
        
        this.activeTooltip = new St.Label({
            style: 'background-color: rgba(0, 0, 0, 0.9); color: white; padding: 8px 12px; border-radius: 6px; font-size: ' + this.fontSize + 'pt; max-width: 300px;'
        });
        
        this.activeTooltip.clutter_text.set_markup(styledText);
        this.activeTooltip.clutter_text.set_line_wrap(true);
        
        global.stage.add_actor(this.activeTooltip);
        
        let [x, y] = global.get_pointer();
        this.activeTooltip.set_position(x + 15, y + 15);
    },

    _hideTooltip: function() {
        if (this.activeTooltip) {
            global.stage.remove_actor(this.activeTooltip);
            this.activeTooltip.destroy();
            this.activeTooltip = null;
        }
    },

    _toggleFavorite: function(app) {
        if (!this.favoriteApps) this.favoriteApps = [];
        let appId = app.get_id();
        let index = this.favoriteApps.indexOf(appId);
        
        if (index === -1) {
            this.favoriteApps.push(appId);
        } else {
            this.favoriteApps.splice(index, 1);
        }
        
        this.settings.setValue("favoriteApps", this.favoriteApps);
        
        if (this.searchEntry && this.searchEntry.get_text() !== '') {
            this.searchEntry.set_text('');
            global.stage.set_key_focus(this.modal);
            this.isSearchMode = false;
        }
        
        this._loadApps();
        this.currentPage = 0;
        this._updateGrid();
    },

    _destroyModal: function() {
        this._hideTooltip();
        if (this.tooltipTimeout) {
            imports.mainloop.source_remove(this.tooltipTimeout);
            this.tooltipTimeout = null;
        }
        if (this.modal && !this.isAnimating) {
            if (this.enableAnimations) {
                this._animateClose();
            } else {
                this._completeDestroy();
            }
        }
    },

    _animateClose: function() {
        this.isAnimating = true;
        let duration = this.animationDuration / 1000;
        let container = this.modal.get_children()[0];
        
        switch(this.closeAnimationType) {
            case 'fade':
                Tweener.addTween(this.modal, {
                    opacity: 0,
                    time: duration,
                    transition: 'easeOutQuad',
                    onComplete: () => { this._completeDestroy(); }
                });
                if (this.blurBackground) {
                    Tweener.addTween(this.blurBackground, {
                        opacity: 0,
                        time: duration,
                        transition: 'easeOutQuad'
                    });
                }
                break;
                
            case 'scale':
                Tweener.addTween(container, {
                    scale_x: 0.8,
                    scale_y: 0.8,
                    opacity: 0,
                    time: duration,
                    transition: 'easeInBack',
                    onComplete: () => { this._completeDestroy(); }
                });
                if (this.blurBackground) {
                    Tweener.addTween(this.blurBackground, {
                        opacity: 0,
                        time: duration,
                        transition: 'easeInBack'
                    });
                }
                break;
                
            case 'slide-down':
                Tweener.addTween(container, {
                    translation_y: 100,
                    opacity: 0,
                    time: duration,
                    transition: 'easeInQuad',
                    onComplete: () => { this._completeDestroy(); }
                });
                if (this.blurBackground) {
                    Tweener.addTween(this.blurBackground, {
                        opacity: 0,
                        time: duration,
                        transition: 'easeInQuad'
                    });
                }
                break;
                
            case 'zoom':
                Tweener.addTween(this.modal, {
                    opacity: 0,
                    time: duration,
                    transition: 'easeInQuad'
                });
                if (this.blurBackground) {
                    Tweener.addTween(this.blurBackground, {
                        opacity: 0,
                        time: duration,
                        transition: 'easeInQuad'
                    });
                }
                Tweener.addTween(container, {
                    scale_x: 0.5,
                    scale_y: 0.5,
                    time: duration,
                    transition: 'easeInCubic',
                    onComplete: () => { this._completeDestroy(); }
                });
                break;
                
            default:
                this._completeDestroy();
        }
    },

_createBlurBackground: function(monitor) {
    let tempFile = '/tmp/app-drawer-blur-' + Date.now() + '.png';
    let blurredFile = '/tmp/app-drawer-blur-blurred-' + Date.now() + '.png';
    
    try {
        let proc = Gio.Subprocess.new(
            ['bash', '-c', 'import -window root -crop ' + monitor.width + 'x' + monitor.height + '+' + monitor.x + '+' + monitor.y + ' ' + tempFile + ' && convert ' + tempFile + ' -blur 0x20 ' + blurredFile],
            Gio.SubprocessFlags.NONE
        );
        
        proc.wait_async(null, (procResult, result) => {
            try {
                procResult.wait_finish(result);
                
                if (!this.modal) {
                    this._cleanupBlurFiles(tempFile, blurredFile);
                    return;
                }
                
                let pixbuf = imports.gi.GdkPixbuf.Pixbuf.new_from_file(blurredFile);
                
                let blurActor = new Clutter.Actor({
                    x: monitor.x,
                    y: monitor.y,
                    width: monitor.width,
                    height: monitor.height,
                    opacity: 0
                });
                
                let image = new Clutter.Image();
                image.set_data(
                    pixbuf.get_pixels(),
                    pixbuf.get_has_alpha() ? imports.gi.Cogl.PixelFormat.RGBA_8888 : imports.gi.Cogl.PixelFormat.RGB_888,
                    pixbuf.get_width(),
                    pixbuf.get_height(),
                    pixbuf.get_rowstride()
                );
                
                blurActor.set_content(image);
                
                global.stage.insert_child_below(blurActor, this.modal);
                this.blurBackground = blurActor;
                
                Tweener.addTween(blurActor, {
                    opacity: 255,
                    time: 0.15,
                    transition: 'easeOutQuad'
                });
                
                this._cleanupBlurFiles(tempFile, blurredFile);
                
            } catch(e) {
                global.log('App drawer blur error: ' + e);
                this._cleanupBlurFiles(tempFile, blurredFile);
            }
        });
        
    } catch(e) {
        global.log('App drawer blur process error: ' + e);
    }
},

    _cleanupBlurFiles: function(tempFile, blurredFile) {
        imports.mainloop.timeout_add(1000, () => {
            try {
                let file1 = Gio.file_new_for_path(tempFile);
                let file2 = Gio.file_new_for_path(blurredFile);
                file1.delete(null);
                file2.delete(null);
            } catch(e) {}
            return false;
        });
    },

    _destroyBlurBackground: function() {
        if (this.blurBackground) {
            try {
                global.stage.remove_actor(this.blurBackground);
                this.blurBackground.destroy();
                this.blurBackground = null;
            } catch(e) {}
        }
    },

    _completeDestroy: function() {
        this._hideTooltip();
        if (this.tooltipTimeout) {
            imports.mainloop.source_remove(this.tooltipTimeout);
            this.tooltipTimeout = null;
        }
        this._destroyBlurBackground();
        if (this.modal) {
            Main.popModal(this.modal);
            global.stage.remove_actor(this.modal);
            this.modal.destroy();
            this.modal = null;
            this.searchEntry = null;
            this.scrollAdjustment = null;
        }
        this.isAnimating = false;
        this.isSearchMode = false;
    },

    on_applet_removed_from_panel: function() {
        this.enableAnimations = false;
        this._destroyModal();
    }
};

function main(metadata, orientation, panel_height, instance_id) {
    return new MyApplet(metadata, orientation, panel_height, instance_id);
}