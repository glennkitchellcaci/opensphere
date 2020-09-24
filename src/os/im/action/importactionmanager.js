goog.provide('os.im.action.ImportActionManager');

goog.require('goog.events.EventTarget');
goog.require('goog.events.EventType');
goog.require('goog.log');
goog.require('ol.array');
goog.require('os.im.action.FilterActionEntry');
goog.require('os.im.action.ImportActionEventType');
goog.require('os.im.action.TagName');
goog.require('os.im.action.cmd.FilterActionAdd');
goog.require('os.im.action.default');
goog.require('os.plugin.PluginManager');
goog.require('os.ui.filter');


/**
 * Manager for import actions.
 *
 * @extends {goog.events.EventTarget}
 * @constructor
 * @template T
 */
os.im.action.ImportActionManager = function() {
  os.im.action.ImportActionManager.base(this, 'constructor');

  /**
   * The user-facing name of import actions for the manager.
   * @type {string}
   */
  this.entryTitle = 'Import Action';

  /**
   * The XML element name for an exported import action entry.
   * @type {string}
   */
  this.xmlEntry = os.im.action.TagName.IMPORT_ACTION;

  /**
   * The XML element name for an exported group of import actions.
   * @type {string}
   */
  this.xmlGroup = os.im.action.TagName.IMPORT_ACTIONS;

  /**
   * Action entries.
   * @type {!Object<string, !Array<!os.im.action.FilterActionEntry<T>>>}
   * @protected
   */
  this.actionEntries = {};

  /**
   * Registered import actions.
   * @type {!Object<string, !os.im.action.IImportAction<T>>}
   * @protected
   */
  this.actionRegistry = {};

  /**
   * The logger.
   * @type {goog.log.Logger}
   * @protected
   */
  this.log = os.im.action.ImportActionManager.LOGGER_;

  /**
   * Key used to save import actions to storage.
   * @type {string}
   * @protected
   */
  this.storageKey = os.im.action.ImportActionManager.STORAGE_KEY;

  /**
   * Map to cache which default actions have been loaded.
   * @type {!Object<string, !goog.Promise>}
   * @protected
   */
  this.defaultsLoaded = {};

  // load import actions from storage once plugins have been loaded
  var pm = os.plugin.PluginManager.getInstance();
  pm.listenOnce(goog.events.EventType.LOAD, this.load, false, this);

  os.dispatcher.listen(os.im.action.ImportActionEventType.ADD_ENTRY, this.onAddActionEntry_, false, this);
};
goog.inherits(os.im.action.ImportActionManager, goog.events.EventTarget);
goog.addSingletonGetter(os.im.action.ImportActionManager);


/**
 * Logger for os.im.action.ImportActionManager.
 * @type {goog.log.Logger}
 * @private
 * @const
 */
os.im.action.ImportActionManager.LOGGER_ = goog.log.getLogger('os.im.action.ImportActionManager');


/**
 * @type {string}
 * @const
 */
os.im.action.ImportActionManager.STORAGE_KEY = 'os.importActions';


/**
 * @type {number}
 * @const
 */
os.im.action.ImportActionManager.MIN_ITEMS_MERGE_NOTIFY_COLOR = 10000;


/**
 * @inheritDoc
 */
os.im.action.ImportActionManager.prototype.disposeInternal = function() {
  os.im.action.ImportActionManager.base(this, 'disposeInternal');

  os.dispatcher.unlisten(os.im.action.ImportActionEventType.ADD_ENTRY, this.onAddActionEntry_, false, this);
};


/**
 * Create a new import action by identifier.
 *
 * @param {string} id The action identifier.
 * @param {Object=} opt_config Configuration to restore.
 * @return {os.im.action.IImportAction<T>}
 */
os.im.action.ImportActionManager.prototype.createAction = function(id, opt_config) {
  var action = null;

  if (id && this.actionRegistry[id]) {
    action = this.actionRegistry[id].clone();

    if (opt_config) {
      action.restore(opt_config);
    }
  }

  return action;
};


/**
 * Create a new import action from an XML element.
 *
 * @param {Element} xml The XML element.
 * @return {os.im.action.IImportAction<T>}
 */
os.im.action.ImportActionManager.prototype.createActionFromXml = function(xml) {
  var action = null;
  if (xml) {
    var localName = xml.localName.toLowerCase();

    for (var id in this.actionRegistry) {
      var current = this.actionRegistry[id];
      if (current.xmlType.toLowerCase() == localName) {
        action = current.clone();
        action.fromXml(xml);
        break;
      }
    }
  }

  return action;
};


/**
 * Get the import actions registered with the application.
 *
 * @return {!Array<!os.im.action.IImportAction<T>>}
 */
os.im.action.ImportActionManager.prototype.getActions = function() {
  return goog.object.getValues(this.actionRegistry);
};


/**
 * If there are import actions registered with the application.
 *
 * @return {boolean}
 */
os.im.action.ImportActionManager.prototype.hasActions = function() {
  return !goog.object.isEmpty(this.actionRegistry);
};


/**
 * Register an import action with the application.
 *
 * @param {!os.im.action.IImportAction} action The import action.
 */
os.im.action.ImportActionManager.prototype.registerAction = function(action) {
  if (action.id) {
    if (action.id in this.actionRegistry) {
      goog.log.warning(this.log, 'The import action with id "' + action.id + '" is being overridden!');
    }

    this.actionRegistry[action.id] = action;
  } else {
    goog.log.error(this.log, 'Unable to register import action without an identifier! Action label is "' +
        action.getLabel() + '".');
  }
};


/**
 * Clear all import action entries.
 */
os.im.action.ImportActionManager.prototype.clearActionEntries = function() {
  goog.object.clear(this.actionEntries);
  this.apply();
};


/**
 * Create a new import action entry.
 *
 * @return {!os.im.action.FilterActionEntry<T>}
 */
os.im.action.ImportActionManager.prototype.createActionEntry = function() {
  return new os.im.action.FilterActionEntry();
};


/**
 * Get an import action entry by id.
 *
 * @param {string|undefined} id The id.
 * @param {string=} opt_type The entry type.
 * @return {os.im.action.FilterActionEntry<T>} The import action entry, or null if not found.
 */
os.im.action.ImportActionManager.prototype.getActionEntry = function(id, opt_type) {
  var list = this.getActionEntries(opt_type);
  var val = null;

  var finder = function(entry) {
    if (val) {
      return;
    }

    if (entry.getId() == id) {
      val = entry;
      return;
    }

    var children = entry.getChildren();
    if (children) {
      children.forEach(finder);
    }
  };

  list.forEach(finder);

  return val;
};


/**
 * Get the import action entries.
 *
 * @param {string=} opt_type The entry type, or undefined to get all entries.
 * @return {!Array<!os.im.action.FilterActionEntry<T>>}
 */
os.im.action.ImportActionManager.prototype.getActionEntries = function(opt_type) {
  var entries;

  if (opt_type) {
    // return entries for the provided type
    entries = this.actionEntries[opt_type] ? this.actionEntries[opt_type].slice() : [];
  } else {
    // no type - return all entries
    entries = [];

    for (var type in this.actionEntries) {
      entries = entries.concat(this.actionEntries[type]);
    }
  }

  return entries;
};


/**
 * Set the import action entries for a type.
 *
 * @param {string|undefined} type The entry type.
 * @param {!Array<!os.im.action.FilterActionEntry<T>>} entries The action entries.
 */
os.im.action.ImportActionManager.prototype.setActionEntries = function(type, entries) {
  if (type) {
    this.actionEntries[type] = entries;
    this.apply();
  }
};


/**
 * Add an import action entry.
 *
 * @param {os.im.action.FilterActionEntry<T>} entry The import action entry.
 * @param {number=} opt_index The index in the entry list.
 * @param {string=} opt_parentId The parent node ID.
 * @param {boolean=} opt_skipApply If the apply call should be skipped. Intended for internal use by the manager.
 */
os.im.action.ImportActionManager.prototype.addActionEntry = function(entry, opt_index, opt_parentId, opt_skipApply) {
  if (entry && entry.type && entry.getFilter()) {
    var index = -1;
    if (!(entry.type in this.actionEntries)) {
      // no entries for the type - create the array
      this.actionEntries[entry.type] = [];
    } else {
      // check if the entry already exists
      var list = this.getActionEntries(entry.type);
      index = ol.array.findIndex(list, function(e) {
        return e.getId() == entry.getId();
      });
    }

    if (opt_parentId) {
      var parent = this.getActionEntry(opt_parentId);
      if (parent) {
        parent.addChild(entry, opt_index);
      }
    } else {
      var entries = this.actionEntries[entry.type];
      if (index > -1) {
        // replace the existing entry
        entries[index] = entry;
      } else if (opt_index > -1 && opt_index < entries.length) {
        // insert at the given index
        goog.array.insertAt(entries, entry, opt_index);
      } else {
        // append to the end of the array
        entries.push(entry);
      }
    }

    if (!opt_skipApply) {
      this.apply();
    }
  }
};


/**
 * Get all items to process for an entry type.
 *
 * @param {string} type The import action entry type.
 * @return {Array<T>} The items to process.
 * @protected
 */
os.im.action.ImportActionManager.prototype.getEntryItems = function(type) {
  return null;
};


/**
 * Executes enabled import action entries of a type against a set of items.
 * @param {string} entryType The entry type.
 * @param {Array<T>} items The items to process.
 * @param {boolean=} opt_unprocess Reset existing items
 * @param {boolean=} opt_unprocessOnly Do not process enabled entries
 * @private
 */
os.im.action.ImportActionManager.prototype.processItemsInternal_ = function(
    entryType,
    items,
    opt_unprocess,
    opt_unprocessOnly) {
  if (items && items.length > 0) {
    var promises = [];
    var entries = this.actionEntries[entryType];
    if (entries && entries.length > 0) {
      for (var i = 0; i < entries.length; i++) {
        var ps = null;
        if (!opt_unprocessOnly && entries[i].isEnabled()) {
          ps = entries[i].processItems(items);
        } else if (opt_unprocess || opt_unprocessOnly) {
          ps = entries[i].unprocessItems(items);
        }
        if (ps) {
          ps.forEach((p) => {
            promises.push(p);
          });
        }
      }
    }

    if (promises.length > 0) {
      // once all processItems() are done, do a big notify of style and color changes
      Promise.all(promises).then((results) => {
        var config = /* @type {os.im.action.ImportActionCallbackConfig} */ ({
          color: [],
          labelUpdateShown: false,
          notifyStyleChange: false,
          setColor: false,
          setFeaturesStyle: false
        });

        // merge the layer, source, colormodel, and label events into one
        results.forEach((cfg) => {
          os.im.action.ImportActionManager.mergeNotify_(config, cfg);
        });

        // optimize the colors to avoid overlaps (max N instead of N^2 events)
        os.im.action.ImportActionManager.mergeNotifyColor_(config);

        // send events to synch with renderer and bins
        os.im.action.ImportActionManager.notify_(items, config);
      });
    }
  }
};


/**
 * Executes enabled import action entries of a type against a set of items.
 *
 * @param {string} entryType The entry type.
 * @param {Array<T>=} opt_items The items to process.
 * @param {boolean=} opt_unprocess Reset existing items
 */
os.im.action.ImportActionManager.prototype.processItems = function(entryType, opt_items, opt_unprocess) {
  var items = opt_items || this.getEntryItems(entryType);
  if (items && items.length > 0) {
    this.processItemsInternal_(entryType, items, opt_unprocess);
  }
};


/**
 * Explicit call to unprocess items - used when an action is removed
 *
 * @param {string} entryType The entry type.
 * @param {Array<T>} items The items to process.
 */
os.im.action.ImportActionManager.prototype.unprocessItems = function(entryType, items) {
  if (items && items.length > 0) {
    this.processItemsInternal_(entryType, items, true, true);
  }
};


/**
 * Consolidate results of desired notification(s) from multiple FeatureActions
 *
 * @param {os.im.action.ImportActionCallbackConfig} config
 * @param {os.im.action.ImportActionCallbackConfig} cfg
 * @private
 */
os.im.action.ImportActionManager.mergeNotify_ = function(config, cfg) {
  if (!config) return;

  if (cfg) {
    config.labelUpdateShown = config.labelUpdateShown || cfg.labelUpdateShown;
    config.notifyStyleChange = config.notifyStyleChange || cfg.notifyStyleChange;
    config.setColor = config.setColor || cfg.setColor;
    config.setFeaturesStyle = config.setFeaturesStyle || cfg.setFeaturesStyle;

    if (cfg.color) {
      // add the next colors
      cfg.color.forEach((color) => {
        // TODO merge same-colors into a single color entry
        config.color.push(color); // flatten the tree
      });
    }
  }
};

/**
 * Optimize the colors to avoid overlaps (max N instead of N^2 events)
 *
 * @param {os.im.action.ImportActionCallbackConfig} config
 * @private
 */
os.im.action.ImportActionManager.mergeNotifyColor_ = function(config) {
  // TODO benchmark which is faster -- removing overlaps or just re-setting them when there's 25%...100% overlap
  var len = (config) ? config.color.length : -1;

  // only do this extra step when there are more than one (possibly conflicting) color actions
  if (len > 1) {
    var colorItemsCount = config.color.reduce((count, colorConfig) => {
      return count + ((colorConfig[0]) ? colorConfig[0].length : 0);
    }, 0);

    // deconflicting is expensive; only do it when there are more than N items being colored
    if (colorItemsCount > os.im.action.ImportActionManager.MIN_ITEMS_MERGE_NOTIFY_COLOR) {
      // the item(s) whose final color is already set
      var all = {};

      // loop backwards through colors... and remove items overlap in previous entries (last one wins)
      for (var i = (len - 1); i >= 0; i--) {
        var ids = {};
        var [items] = config.color[i] || [];

        // map the array by ids
        if (i > 0) { // skip when no more loops to do
          (items || []).reduce((map, item) => {
            map[item.id_] = true;
            return map;
          }, ids);
        }
        // remove all's ids from these items
        if (i != (len - 1)) { // skip when "all" is empty
          config.color[i][0] = items.filter((item) => {
            return !all[item.id_]; // fast lookup
          });
        }

        // add these ids to all so they'll be filtered from prior color assignments
        if (i > 0) { // skip when no more loops to do
          for (var key in ids) { // for...in is faster than Object.assign(all, ids);
            all[key] = true;
          }
        }
      }
    }
  }
};


/**
 * Send style event(s) to Layer, Source, and ColorModel
 *
 * @param {Array<T>} items The items.
 * @param {os.im.action.ImportActionCallbackConfig} config
 * @template T
 * @private
 */
os.im.action.ImportActionManager.notify_ = function(items, config) {
  if (config) {
    if (config.setFeaturesStyle) {
      os.style.setFeaturesStyle(items);
    }

    // notify that the layer needs to be updated
    var layer = os.feature.getLayer(items[0]);
    if (layer) {
      var source = /** @type {os.source.Vector} */ (layer.getSource());
      if (source && config.setColor && config.color && config.color.length > 0) {
        var colors = (config.color != null) ? config.color : []; // useless assign to get past the closure compiler
        colors.forEach(([coloritems, color]) => {
          if (color) {
            source.setColor(coloritems, color); // set the color model's override for these items
          } else {
            source.setColor(coloritems); // only reset the color if there was a color override
          }
        });
      }
      if (config.notifyStyleChange) {
        os.style.notifyStyleChange(
            layer,
            items,
            undefined,
            undefined,
            !!(source && config.setColor) // bump the colormodel so dependencies can update/re-render
        );
      }
    }
  }
  // kick off label hit detection
  if (config.labelUpdateShown) {
    os.style.label.updateShown();
  }
};


/**
 * Reapplies all actions on applicable data types. This acts to both apply the actions to new features as well
 * as to unapply them from old features.
 *
 * @param {string} entryType The entry type.
 * @param {Array<T>=} opt_items The items to process.
 */
os.im.action.ImportActionManager.prototype.updateItems = function(entryType, opt_items) {
  window['currentFilterTimestamp'] = Date.now();

  var items = opt_items || this.getEntryItems(entryType);
  if (items && items.length > 0) {
    var entries = this.actionEntries[entryType];
    if (entries && entries.length > 0) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isEnabled()) {
          entries[i].updateItems(items);
        }
      }
    }
  }
};


/**
 * Remove an import action entry.
 *
 * @param {os.im.action.FilterActionEntry<T>} entry The import action entry.
 * @param {string=} opt_parentId The parent node ID.
 */
os.im.action.ImportActionManager.prototype.removeActionEntry = function(entry, opt_parentId) {
  if (entry && entry.type in this.actionEntries) {
    this.unprocessItems(entry.type, this.getEntryItems(entry.type));

    if (opt_parentId) {
      var parent = this.getActionEntry(opt_parentId);
      if (parent) {
        parent.removeChild(entry);
      }
    } else {
      var entries = this.actionEntries[entry.type];
      ol.array.remove(entries, entry);

      if (entries.length == 0) {
        delete this.actionEntries[entry.type];
      }
    }

    this.processItems(entry.type);
    this.apply();
  }
};


/**
 * Load import actions from storage.
 */
os.im.action.ImportActionManager.prototype.load = function() {
  var obj = /** @type {!Object} */ (os.settings.get(this.storageKey, {}));

  for (var type in obj) {
    var entries = [];
    var entryConfigs = /** @type {Array<!Object>} */ (obj[type]);
    if (entryConfigs) {
      for (var i = 0; i < entryConfigs.length; i++) {
        var entry = this.createActionEntry();
        entry.restore(entryConfigs[i]);
        entries.push(entry);
      }
    }

    this.actionEntries[type] = entries;
  }

  this.initialize();
  this.dispatchEvent(os.im.action.ImportActionEventType.REFRESH);
};


/**
 * Load default actions for a source.
 *
 * @param {string} id The internal layer ID.
 * @return {!goog.Promise}
 */
os.im.action.ImportActionManager.prototype.loadDefaults = function(id) {
  if (!this.defaultsLoaded[id]) {
    var defaultActions = /** @type {Object<string, Array<osx.ResourceConfig>>|undefined} */ (
      os.settings.get(os.im.action.default.SettingKey.FILES));

    var filterKey = id;
    var layer = os.map.mapContainer.getLayer(id);
    if (os.implements(layer, os.filter.IFilterable.ID)) {
      filterKey = /** @type {os.filter.IFilterable} */ (layer).getFilterKey();
    }

    if (filterKey && defaultActions && defaultActions[filterKey]) {
      this.defaultsLoaded[id] = os.im.action.default.load(id, defaultActions[filterKey]).then(function(entries) {
        if (entries && entries.length) {
          // add all of the default entries from the right, we are inserting them from the top, so this maintains order
          goog.array.forEachRight(entries, function(entry) {
            // add the entry to the manager but skip apply to defer the refresh event
            this.addActionEntry(entry, 0, undefined, true);
          }, this);

          // notify entries have changed
          this.dispatchEvent(os.im.action.ImportActionEventType.REFRESH);
        }
      }, function(opt_reason) {
        var reason = 'Unspecified error.';
        if (typeof opt_reason == 'string') {
          reason = opt_reason;
        } else if (opt_reason instanceof Error) {
          reason = opt_reason.message;
        }

        goog.log.error(this.log, 'Failed loading default actions for "' + id + '": ' + reason);
      }, this);
    } else {
      // there are no default actions for that ID, so just return a plain resolved promise
      this.defaultsLoaded[id] = goog.Promise.resolve();
    }
  }

  return this.defaultsLoaded[id];
};


/**
 * Initialize the manager when entries have been loaded.
 */
os.im.action.ImportActionManager.prototype.initialize = goog.nullFunction;


/**
 * Apply the manager by sending out an event and saving.
 */
os.im.action.ImportActionManager.prototype.apply = function() {
  this.dispatchEvent(os.im.action.ImportActionEventType.REFRESH);
  this.save();
};


/**
 * Save import actions to storage.
 */
os.im.action.ImportActionManager.prototype.save = function() {
  var defaultEnabled = {};
  var obj = {};

  for (var type in this.actionEntries) {
    var entries = this.actionEntries[type];
    if (entries.length > 0) {
      var entryConfigs = [];
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (e.isDefault()) {
          if (!defaultEnabled[type]) {
            defaultEnabled[type] = {};
          }

          // store the enabled state of default actions
          os.im.action.getEnabledMap(e, defaultEnabled[type]);
        } else if (!e.isTemporary()) {
          // persist the entire entry if it is not a default or temporary action
          entryConfigs.push(e.persist());
        }
      }

      obj[type] = entryConfigs;
    }
  }

  os.settings.set(os.im.action.default.SettingKey.ENABLED, defaultEnabled);
  os.settings.set(this.storageKey, obj);
};


/**
 * Handle an add action entry event fired on the global dispatcher.
 *
 * @param {os.im.action.ImportActionEvent} event The event.
 * @private
 */
os.im.action.ImportActionManager.prototype.onAddActionEntry_ = function(event) {
  var entry = event.entry;

  if (entry && !(entry instanceof os.im.action.FilterActionEntry)) {
    try {
      // probably came from another window context
      var clone = this.createActionEntry();
      clone.restore(entry.persist());

      if (clone instanceof os.im.action.FilterActionEntry) {
        entry = clone;
      } else {
        goog.log.error(this.log, 'Failed adding ' + this.entryTitle.toLowerCase() +
          '. Unable to determine entry type.');
        entry = null;
      }
    } catch (e) {
      goog.log.error(this.log, 'Failed adding ' + this.entryTitle.toLowerCase() + ':', e);
      entry = null;
    }
  }

  if (entry) {
    var cmd = new os.im.action.cmd.FilterActionAdd(entry);
    os.commandStack.addCommand(cmd);

    if (event.execute) {
      var items = this.getEntryItems(entry.getType());
      this.processItems(entry.type, items);
    }
  } else {
    var msg = 'Failed adding ' + this.entryTitle.toLowerCase() + '. See the log for details.';
    os.alertManager.sendAlert(msg, os.alert.AlertEventSeverity.ERROR);
  }
};



/**
 * @param {string} id
 * @return {boolean}
 */
os.im.action.ImportActionManager.prototype.hasActiveActions = function(id) {
  var featureActions = id == undefined ? [] : this.getActionEntries(id);

  const hasActiveActions = (action) => action.isEnabled();

  return featureActions.some(hasActiveActions);
};
