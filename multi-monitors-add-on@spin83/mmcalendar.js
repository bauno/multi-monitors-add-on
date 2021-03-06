/*
Copyright (C) 2014  spin83

This program is free software; you can redistribute it and/or
modify it under the terms of the GNU General Public License
as published by the Free Software Foundation; either version 2
of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program; if not, visit https://www.gnu.org/licenses/.
*/

const Lang = imports.lang;

const St = imports.gi.St;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const Shell = imports.gi.Shell;
const Clutter = imports.gi.Clutter;
const GnomeDesktop = imports.gi.GnomeDesktop;
const GObject = imports.gi.GObject;

const Config = imports.misc.config;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const MessageList = imports.ui.messageList;
const DateMenu = imports.ui.dateMenu;
const Calendar = imports.ui.calendar;

const ExtensionUtils = imports.misc.extensionUtils;
const MultiMonitors = ExtensionUtils.getCurrentExtension();
const Convenience = MultiMonitors.imports.convenience;

const Gettext_gtk30 = imports.gettext.domain('gtk30');
const gtk30_ = Gettext_gtk30.gettext;

const MultiMonitorsCalendar = new Lang.Class({
	Name: 'MultiMonitorsCalendar',
    Extends: Calendar.Calendar,
    
    _init: function() {
    	this._currentVersion = Config.PACKAGE_VERSION.split('.');
        this._weekStart = Shell.util_get_week_start();
        if (this._currentVersion[0]==3 && this._currentVersion[1]>20) {
        	this._settings = new Gio.Settings({ schema_id: 'org.gnome.desktop.calendar' });
        }
        else {
        	this._settings = new Gio.Settings({ schema_id: 'org.gnome.shell.calendar' });
        }
        
        this._showWeekdateKeyId = this._settings.connect('changed::' + Calendar.SHOW_WEEKDATE_KEY, Lang.bind(this, this._onSettingsChange));
        this._useWeekdate = this._settings.get_boolean(Calendar.SHOW_WEEKDATE_KEY);

        // Find the ordering for month/year in the calendar heading
        this._headerFormatWithoutYear = '%B';
        switch (gtk30_('calendar:MY')) {
        case 'calendar:MY':
            this._headerFormat = '%B %Y';
            break;
        case 'calendar:YM':
            this._headerFormat = '%Y %B';
            break;
        default:
            log('Translation of "calendar:MY" in GTK+ is not correct');
            this._headerFormat = '%B %Y';
            break;
        }

        // Start off with the current date
        this._selectedDate = new Date();

        this._shouldDateGrabFocus = false;

        this.actor = new St.Widget({ style_class: 'calendar',
                                     layout_manager: new Clutter.TableLayout(),
                                     reactive: true });

        this.actor.connect('scroll-event',
                           Lang.bind(this, this._onScroll));
        
        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));

        this._buildHeader ();
    },
    
    _onDestroy: function(actor) {
    	this._settings.disconnect(this._showWeekdateKeyId);
    }
});

const MultiMonitorsEventsSection = new Lang.Class({
    Name: 'MultiMonitorsEventsSection',
    Extends: MessageList.MessageListSection,

    _init: function() {
    	this._currentVersion = Config.PACKAGE_VERSION.split('.');
        this._desktopSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        this._reloadEventsId = this._desktopSettings.connect('changed', Lang.bind(this, this._reloadEvents));
        this._eventSource = new Calendar.EmptyEventSource();

        if (this._currentVersion[0]==3 && this._currentVersion[1]>22) {
        	this.parent();

            this._title = new St.Button({ style_class: 'events-section-title',
                                          label: '',
                                          x_align: St.Align.START,
                                          can_focus: true });
            this.actor.insert_child_below(this._title, null);

            this._title.connect('clicked', Lang.bind(this, this._onTitleClicked));
            this._title.connect('key-focus-in', Lang.bind(this, this._onKeyFocusIn));
        }
        else {
        	this.parent('');
        }

        this._defaultAppSystem = Shell.AppSystem.get_default(); 
        this._appInstalledChangedId = this._defaultAppSystem.connect('installed-changed',
                                              Lang.bind(this, this._appInstalledChanged));
        
        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));
        this._appInstalledChanged();
    },
    
    _onDestroy: function(actor) {
    	this._desktopSettings.disconnect(this._reloadEventsId);
    	this._defaultAppSystem.disconnect(this._appInstalledChangedId);
    },

    _ignoreEvent: Calendar.EventsSection.prototype._ignoreEvent,
    setEventSource: Calendar.EventsSection.prototype.setEventSource,

    get allowed() {
        return Main.sessionMode.showCalendarEvents;
    },

    _updateTitle: Calendar.EventsSection.prototype._updateTitle,
    _reloadEvents: Calendar.EventsSection.prototype._reloadEvents,
    _appInstalledChanged: Calendar.EventsSection.prototype._appInstalledChanged,
    _getCalendarApp: Calendar.EventsSection.prototype._getCalendarApp,
    _onTitleClicked: Calendar.EventsSection.prototype._onTitleClicked,
    setDate: Calendar.EventsSection.prototype.setDate,
    _shouldShow: Calendar.EventsSection.prototype._shouldShow,
    _sync: Calendar.EventsSection.prototype._sync
});

const MultiMonitorsNotificationSection = new Lang.Class({
    Name: 'MultiMonitorsNotificationSection',
    Extends: MessageList.MessageListSection,

    _init: function() {
    	this._currentVersion = Config.PACKAGE_VERSION.split('.');
    	
    	if (this._currentVersion[0]==3 && this._currentVersion[1]>22) {
    		this.parent();
    	}
    	else {
    		this.parent(_("Notifications"));
    	}
        this._sources = new Map();
        this._nUrgent = 0;

        this._sourceAddedId = Main.messageTray.connect('source-added', Lang.bind(this, this._sourceAdded));
        Main.messageTray.getSources().forEach(Lang.bind(this, function(source) {
            this._sourceAdded(Main.messageTray, source);
        }));

        this.actor.connect('notify::mapped', Lang.bind(this, this._onMapped));
        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));
    },
    
    _onDestroy: function(actor) {
    	Main.messageTray.disconnect(this._sourceAddedId);
    	let source, obj;
    	for ([source, obj] of this._sources.entries()) {
    		this._onSourceDestroy(source, obj);
    	}
    },

    get allowed() {
        return Main.sessionMode.hasNotifications &&
               !Main.sessionMode.isGreeter;
    },

    _createTimeLabel: Calendar.NotificationSection.prototype._createTimeLabel,
    _sourceAdded: Calendar.NotificationSection.prototype._sourceAdded,
    _onNotificationAdded: Calendar.NotificationSection.prototype._onNotificationAdded,
    _onSourceDestroy: Calendar.NotificationSection.prototype._onSourceDestroy,
    _onMapped: Calendar.NotificationSection.prototype._onMapped
});

const MultiMonitorsCalendarMessageList = new Lang.Class({
    Name: 'MultiMonitorsCalendarMessageList',
    Extends: Calendar.CalendarMessageList,
    
    _init: function() {
    	this._currentVersion = Config.PACKAGE_VERSION.split('.');
    	
        this.actor = new St.Widget({ style_class: 'message-list',
                                     layout_manager: new Clutter.BinLayout(),
                                     x_expand: true, y_expand: true });

        this._placeholder = new Calendar.Placeholder();
        this.actor.add_actor(this._placeholder.actor);

        this._scrollView = new St.ScrollView({ style_class: 'vfade',
                                               overlay_scrollbars: true,
                                               x_expand: true, y_expand: true,
                                               x_fill: true, y_fill: true });
        this._scrollView.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);
        
        if (this._currentVersion[0]==3 && this._currentVersion[1]>22) {
	        let box = new St.BoxLayout({ vertical: true,
	                                     x_expand: true, y_expand: true });
	        this.actor.add_actor(box);

	        box.add_actor(this._scrollView);
	
	        this._clearButton = new St.Button({ style_class: 'message-list-clear-button button',
	                                            label: _("Clear All"),
	                                            can_focus: true });
	        this._clearButton.set_x_align(Clutter.ActorAlign.END);
	        this._clearButton.connect('clicked', () => {
	            let sections = [...this._sections.keys()];
	            sections.forEach((s) => { s.clear(); });
	        });
	        box.add_actor(this._clearButton);
    	}
        else {
        	this.actor.add_actor(this._scrollView);
        }
        this._sectionList = new St.BoxLayout({ style_class: 'message-list-sections',
                                               vertical: true,
                                               y_expand: true,
                                               y_align: Clutter.ActorAlign.START });
        this._scrollView.add_actor(this._sectionList);
        this._sections = new Map();

//        this._mediaSection = new Mpris.MediaSection();
//        this._addSection(this._mediaSection);

        this._notificationSection = new MultiMonitorsNotificationSection();
        this._addSection(this._notificationSection);
        this._eventsSection = new MultiMonitorsEventsSection();
        this._addSection(this._eventsSection);

        this._sessionModeUpdatedId = Main.sessionMode.connect('updated', Lang.bind(this, this._sync));
        
        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));
    },
    
    _onDestroy: function(actor) {
    	Main.sessionMode.disconnect(this._sessionModeUpdatedId);
    }
});

const MultiMonitorsDateMenuButton = new Lang.Class({
    Name: 'MultiMonitorsDateMenuButton',
    Extends: PanelMenu.Button,

    _init: function() {
    	this._currentVersion = Config.PACKAGE_VERSION.split('.');
    	let hbox;
    	let vbox;
    	
        let menuAlignment = 0.5;
        if (Clutter.get_default_text_direction() == Clutter.TextDirection.RTL)
            menuAlignment = 1.0 - menuAlignment;
        this.parent(menuAlignment);

        this._clockDisplay = new St.Label({ y_align: Clutter.ActorAlign.CENTER });
//        this._indicator = new DateMenu.MessagesIndicator()

        let box = new St.BoxLayout();
//        box.add_actor(new DateMenu.IndicatorPad(this._indicator.actor));
        box.add_actor(this._clockDisplay);
//        box.add_actor(this._indicator.actor);

        this.actor.label_actor = this._clockDisplay;
        this.actor.add_actor(box);
        this.actor.add_style_class_name ('clock-display');
        
        let layout = new DateMenu.FreezableBinLayout();
        let bin = new St.Widget({ layout_manager: layout });
        this.menu.box.add_child(bin);

        hbox = new St.BoxLayout({ name: 'calendarArea' });
        bin.add_actor(hbox);
        this._calendar = new MultiMonitorsCalendar();
        this._calendar.connect('selected-date-changed',
                               Lang.bind(this, function(calendar, date) {
                                   layout.frozen = !DateMenu._isToday(date);
                                   this._messageList.setDate(date);
                               }));

        this.menu.connect('open-state-changed', Lang.bind(this, function(menu, isOpen) {
            // Whenever the menu is opened, select today
            if (isOpen) {
                let now = new Date();
                this._calendar.setDate(now);
                this._date.setDate(now);
                this._messageList.setDate(now);
            }
        }));

        // Fill up the first column
        this._messageList = new MultiMonitorsCalendarMessageList();
        hbox.add(this._messageList.actor, { expand: true, y_fill: false, y_align: St.Align.START });

        // Fill up the second column
        if (this._currentVersion[0]==3 && this._currentVersion[1]>22) {
	        let boxLayout = new DateMenu.CalendarColumnLayout(this._calendar.actor);
	        vbox = new St.Widget({ style_class: 'datemenu-calendar-column',
	                               layout_manager: boxLayout });
	        boxLayout.hookup_style(vbox);
        }
        else {
            vbox = new St.BoxLayout({ style_class: 'datemenu-calendar-column',
                vertical: true });
        }
        hbox.add(vbox);
        
        this._date = new DateMenu.TodayButton(this._calendar);
        vbox.add_actor(this._date.actor);

        vbox.add_actor(this._calendar.actor);

        this._clock = new GnomeDesktop.WallClock();
        this._clock.bind_property('clock', this._clockDisplay, 'text', GObject.BindingFlags.SYNC_CREATE);
        
        this._sessionModeUpdatedId = Main.sessionMode.connect('updated', Lang.bind(this, this._sessionUpdated));
        
        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));
        
        this._sessionUpdated();
    },
    
    _onDestroy: function(actor) {
    	Main.sessionMode.disconnect(this._sessionModeUpdatedId);
    },
    
    _getEventSource: function() {
        return new Calendar.DBusEventSource();
    },

    _setEventSource: function(eventSource) {
        if (this._eventSource)
            this._eventSource.destroy();

        this._calendar.setEventSource(eventSource);
        this._messageList.setEventSource(eventSource);

        this._eventSource = eventSource;
    },

    _sessionUpdated: function() {
        let eventSource;
        let showEvents = Main.sessionMode.showCalendarEvents;
        if (showEvents) {
            eventSource = this._getEventSource();
        } else {
            eventSource = new Calendar.EmptyEventSource();
        }
        this._setEventSource(eventSource);

        // Displays are not actually expected to launch Settings when activated
        // but the corresponding app (clocks, weather); however we can consider
        // that display-specific settings, so re-use "allowSettings" here ...
//        this._displaysSection.visible = Main.sessionMode.allowSettings;
    }
    
});
