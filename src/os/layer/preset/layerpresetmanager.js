goog.module('os.layer.preset.LayerPresetManager');
goog.module.declareLegacyNamespace();

const Debouncer = goog.require('goog.async.Debouncer');
const Dispatcher = goog.require('os.Dispatcher');
const Disposable = goog.require('goog.Disposable');
const GoogEventType = goog.require('goog.events.EventType');
const IFilterable = goog.require('os.filter.IFilterable');
const ILayer = goog.require('os.layer.ILayer');
const ImportActionManager = goog.require('os.im.action.ImportActionManager');
const LayerEventType = goog.require('os.events.LayerEventType');
const OsLayerPreset = goog.require('os.layer.preset');
const OsStyle = goog.require('os.style');
const Promise = goog.require('goog.Promise');
const Registry = goog.require('os.data.Registry');
const SettingsPresetService = goog.require('os.layer.preset.SettingsPresetService');
const VectorLayerPreset = goog.require('os.command.VectorLayerPreset');

const settings = goog.require('os.config.Settings');
const olEvents = goog.require('ol.events');
const osImplements = goog.require('os.implements');

const IPresetService = goog.requireType('os.layer.preset.IPresetService');
const LayerEvent = goog.requireType('os.events.LayerEvent');
const {EventsKey: OlEventsKey} = goog.requireType('ol');
const OlLayer = goog.requireType('ol.layer.Layer');
const PropertyChangeEvent = goog.requireType('os.events.PropertyChangeEvent');


/**
 * @typedef {{
 *   debouncer: (!Debouncer),
 *   listener: (OlEventsKey|null),
 *   selected: (osx.layer.Preset|null)
 * }}
 */
let LayerPresetsMetaData;

/**
 * Manager for keeping track of available layer presets. These presets consist of a layer options object and a
 * reference to a set of default feature actions.
 */
class LayerPresetManager extends Disposable {
  /**
   * Constructor.
   */
  constructor() {
    super();

    /**
     * True if the user can edit/remove/publish presets. Shows/hides UI elements, etc
     * @type {!boolean}
     */
    this.admin_ = false;

    /**
     * The available service(s) which can get Presets for a LayerId
     * @type {!Registry<IPresetService>}
     * @private
     */
    this.services_ = new Registry();

    /**
     * The available layer presets.
     * @type {!Registry<Promise<Array<osx.layer.Preset>>>}
     * @private
     */
    this.presets_ = new Registry();

    // add the basic PresetService; not an admin
    this.registerService(SettingsPresetService.ID, new SettingsPresetService(), false);

    // listen for new layers
    Dispatcher.getInstance().listen(LayerEventType.ADD, this.onLayerAdded, false, this);
    Dispatcher.getInstance().listen(LayerEventType.REMOVE, this.onLayerRemoved, false, this);
  }

  /**
   * @inheritDoc
   */
  disposeInternal() {
    super.disposeInternal();

    this.clearLayerPresets();
    this.services_.dispose();

    Dispatcher.getInstance().unlisten(LayerEventType.ADD, this.onLayerAdded, false, this);
    Dispatcher.getInstance().unlisten(LayerEventType.REMOVE, this.onLayerRemoved, false, this);
  }

  /**
   * Handle layer added to the map.
   * @param {!LayerEvent} event The layer event.
   * @protected
   */
  onLayerAdded(event) {
    const layer = osImplements(event.layer, ILayer.ID) ?
        /** @type {ILayer} */ (event.layer) : undefined;

    if (layer) {
      const layerId = layer.getId();
      if (layerId) {
        this.getPresets(layerId, true);
      }
    }
  }

  /**
   * Handle layer removed the map.
   * @param {!LayerEvent} event The layer event.
   * @protected
   */
  onLayerRemoved(event) {
    const layer = osImplements(event.layer, ILayer.ID) ?
        /** @type {ILayer} */ (event.layer) : undefined;

    if (layer) {
      const layerId = layer.getId();
      this.clearLayerPreset(layerId);
    }
  }

  /**
   *
   * @param {!string} layerId
   * @param {!osx.layer.Preset} preset
   */
  listenToLayerStyleChange(layerId, preset) {
    const layer = this.getLayer_(layerId);
    let [,, meta] = /** @type {!Array<*>} */ (this.presets_.entry(layerId));
    meta = /** @type {!LayerPresetsMetaData} */ (meta);

    // only have one listener at a time
    if (layer && meta && !meta.listener) {
      meta.selected = preset;
      meta.listener = olEvents.listen(
          layer,
          GoogEventType.PROPERTYCHANGE,
          this.onLayerStyleChanged.bind(this, layerId, layer, false),
          this);
    }
  }

  /**
   * Handle layer style changed debouncer.
   * @param {!string} layerId The layer id.
   * @param {!OlLayer} layer The layer.
   * @param {!boolean} check True if the current style needs to be tested extensively against the Preset style
   * @param {!PropertyChangeEvent} event The layer event.
   * @protected
   */
  onLayerStyleChanged(layerId, layer, check, event) {
    let [,, meta] = /** @type {!Array<*>} */ (this.presets_.entry(layerId));
    meta = /** @type {!LayerPresetsMetaData} */ (meta);

    // get the debouncer for this layerId
    if (meta && !meta.debouncer.isDisposed()) {
      meta.debouncer.fire(check, event);
    }
  }

  /**
   * Handle layer style changed.
   * @param {!string} layerId The layer id.
   * @param {!OlLayer} layer The layer.
   * @param {!boolean} check True if the current style needs to be tested extensively against the Preset style
   * @param {!PropertyChangeEvent} event The layer event.
   * @private
   */
  onLayerStyleChanged_(layerId, layer, check, event) {
    // check that the style does/doesn't match the Preset. If not, set the clean over to false and stop listening
    if (layer && event['getProperty'] && event.getProperty() == 'style') {
      if (this.isLayerStyleDirty_(layerId, layer, check, event)) {
        let [,, meta] = /** @type {!Array<*>} */ (this.presets_.entry(layerId));
        meta = /** @type {!LayerPresetsMetaData} */ (meta);

        const key = /** @type {OlEventsKey} */ (meta.listener);
        if (key && layer) {
          olEvents.unlistenByKey(key);
          meta.listener = null;
        }

        OsLayerPreset.setSavedPresetClean(layerId, false);
        OsStyle.notifyStyleChange(layer);
      }
    }
  }

  /**
   * Handle layer style changed.
   * @param {!string} layerId The layer id.
   * @param {!OlLayer} layer The layer.
   * @param {!boolean} check True if the current style needs to be tested extensively against the Preset style
   * @param {!PropertyChangeEvent} event The layer event.
   * @return {boolean} true if the style is what the preset says it should be
   * @private
   */
  isLayerStyleDirty_(layerId, layer, check, event) {
    let dirty = false;
    let [,, meta] = /** @type {!Array<*>} */ (this.presets_.entry(layerId));
    meta = /** @type {!LayerPresetsMetaData} */ (meta);

    if (meta && meta.selected) {
      // check the layer configs
      const config1 = meta.selected.layerConfig;
      const config2 = /** @type {ILayer} */ (layer).persist();
      dirty = (JSON.stringify(config1) != JSON.stringify(config2));

      // check the active Feature Actions if not dirty yet
      if (!dirty && meta.selected.featureActions && meta.selected.featureActions.length > 0) {
        const ids1 = meta.selected.featureActions;
        const ids2 = ImportActionManager.getInstance().getActiveActionEntryIds(layerId);
        dirty = (ids1.join('') != ids2.join(''));
      }
    }
    return dirty;
  }

  /**
   * Clean up the memory for the listener, debouncer, and presets promise for a Layer
   * @param {!string} layerId The layer id.
   */
  clearLayerPreset(layerId) {
    const entry = this.presets_.entry(layerId);
    if (entry) {
      this.clearLayerPresets([entry]);
    }
  }

  /**
   * Clean up all the listeners, debouncers, and presets
   *
   * @param {Array<Array<*>>=} opt_entries
   */
  clearLayerPresets(opt_entries = this.presets_.entries()) {
    // first, loop and remove the listeners and debouncers
    opt_entries.forEach(([id, , meta]) => {
      id = /** @type {!string} */ (id);
      meta = /** @type {!LayerPresetsMetaData} */ (meta);

      const key = /** @type {OlEventsKey} */ (meta.listener);
      const layer = this.getLayer_(id);
      if (key && layer) {
        olEvents.unlistenByKey(key);
      }
      meta.listener = null;
      meta.debouncer.dispose();
    });

    // then, wipe the promises too
    this.presets_.clear();
  }

  /**
   * @param {boolean=} b
   * @return {!boolean}
   */
  isAdmin(b) {
    if (b === true || b === false) {
      this.admin_ = (b === true);
    }
    return this.admin_;
  }

  /**
   * Returns a list of PresetServices which support the action
   *
   * @param {OsLayerPreset.PresetServiceAction} action
   * @return {Array<IPresetService>}
   */
  supporting(action) {
    const services = [];
    const entries = (this.services_.entries() || []);
    for (var [, service] of entries) {
      if (service.supports(action)) services.push(service);
    }
    return services;
  }

  /**
   * @param {string} key
   * @param {IPresetService} service
   * @param {...} opt
   * @return {boolean} true if prior value overwritten
   */
  registerService(key, service, ...opt) {
    this.clearLayerPresets(); // set presets to reload every layer
    return this.services_.register(...[key, service].concat(opt));
  }

  /**
   * @param {string} key
   * @return {boolean} true if prior value dropped
   */
  unregisterService(key) {
    this.clearLayerPresets(); // set presets to reload every layer
    return this.services_.remove(key);
  }

  /**
   * Helper function
   * @param {!string} layerId
   * @return {?OlLayer}
   * @private
   */
  getLayer_(layerId) {
    // HACK: doing goog.require('os.MapContainer') properly creates a circular dependency somewhere in
    // the os.layer chain. TODO Fix it when there's time
    return (os.map.mapContainer) ? os.map.mapContainer.getLayer(layerId) : null;
  }

  /**
   * Gets a promise that resolves to the presets for a given layer ID.
   *
   * @param {string} id The layer ID.
   * @param {boolean=} opt_applyDefault Whether to apply the default styles on load.
   * @return {Promise<Array<osx.layer.Preset>>|undefined}
   */
  getPresets(id, opt_applyDefault) {
    var promise = this.presets_.get(id);

    if (!promise) {
      // Do NOT pass opt_applyDefault down to initPreset; applyDefaults() is called on-demand below, possibly
      // on an already-resolved promise
      this.initPreset(id);
      promise = this.presets_.get(id);
    }

    // handle this separately from the initPreset so future calls to getPresets can try to applyDefaults()
    if (promise && opt_applyDefault) {
      promise.then((presets) => {
        this.applyDefaults(id, presets);
      });
    }
    return promise;
  }

  /**
   * Initializes the layer presets for a layer.
   *
   * @param {string} id The layer ID.
   * @param {boolean=} opt_applyDefault Whether to apply the default styles on load.
   * @protected
   */
  initPreset(id, opt_applyDefault) {
    // use the filter key to pull the value from settings
    var filterKey;
    var layer = this.getLayer_(id);

    if (!layer) return; // extra check; can't do presets without a working layer to which to add them

    if (osImplements(layer, IFilterable.ID)) {
      filterKey = /** @type {IFilterable} */ (layer).getFilterKey();
    }

    var promise = new Promise((resolve, reject) => {
      var entries = (this.services_.entries() || []);
      var promises = [];

      this.isAdmin(false); // disable the admin UI

      for (var [, service, isAdmin] of entries) {
        if (isAdmin) this.isAdmin(true); // enable the admin UI if User has admin in any service

        if (filterKey && service.supports(OsLayerPreset.PresetServiceAction.FIND)) {
          promises.push(service.find(/** @type {osx.layer.PresetSearch} */ ({
            layerId: [id],
            layerFilterKey: [filterKey],
            published: (!isAdmin) ? true : undefined
          })));
        }
      }

      if (promises.length) {
        Promise.all(promises).then((results) => {
          var presets = results.reduce((list, result) => {
            if (result && result.length) {
              return list.concat(result);
            }
            return list;
          }, []);

          // sort
          if (presets.length > 0) {
            presets.sort((a, b) => {
              const aLabel = a ? a.label : '';
              const bLabel = b ? b.label : '';
              return (aLabel || '').localeCompare(bLabel || '');
            });
          }

          // add a "Basic" preset to the list if there are user-defined ones OR the user is an admin
          if (presets.length > 0 || this.isAdmin()) {
            OsLayerPreset.addDefault(presets, id, filterKey || undefined);
            OsLayerPreset.updateDefault(/** @type {ILayer} */ (layer), presets.find((preset) => {
              return preset.id == OsLayerPreset.DEFAULT_PRESET_ID;
            }));
          }

          // return the list to any .then() bindings
          resolve(presets);
        });
      } else {
        resolve(null);
      }
    });

    // apply the "isDefault" preset if asked
    if (opt_applyDefault) {
      promise.then((presets) => {
        this.applyDefaults(id, presets);
      });
    } else {
      promise.then((presets) => {
        this.applyNone(id, presets);
      });
    }

    const meta = /** @type {LayerPresetsMetaData} */ ({
      listener: null,
      debouncer: new Debouncer(this.onLayerStyleChanged_.bind(this, id, layer), 250, this)
    });

    this.presets_.register(id, promise, meta);
  }

  /**
   * Checks if Style matches the last-set Preset and initializes listeners if so.
   *
   * @param {string} id The layer ID.
   * @param {Array<osx.layer.Preset>} presets The presets.
   * @protected
   */
  applyNone(id, presets) {
    if (presets && presets.length) {
      const isCleanPreset = OsLayerPreset.getSavedPresetClean(id);

      // don't set up the listener if it's already dirty
      if (isCleanPreset) {
        const presetId = OsLayerPreset.getSavedPresetId(id);
        const preset = presets.find((p) => {
          return p.id == presetId;
        });
        if (preset) {
          this.listenToLayerStyleChange(id, preset);
        }
      }
    }
  }

  /**
   * Checks if there is a default preset and applies it if so.
   *
   * @param {string} id The layer ID.
   * @param {Array<osx.layer.Preset>} presets The presets.
   * @protected
   */
  applyDefaults(id, presets) {
    if (Array.isArray(presets) && presets.length) {
      var applied = /** @type {!Object<boolean>} */
          (settings.getInstance().get(OsLayerPreset.SettingKey.APPLIED_DEFAULTS, {}));

      if (!applied[id]) {
        var preset = presets.find(function(preset) {
          return preset.default || false; // TODO gets the first one; instead, look for the first and latest updated
        });

        if (preset) {
          this.applyPreset(id, preset);
        }

        // apply the Default style for a layer only once as long as the settings remain intact
        applied[id] = true;
        settings.getInstance().set(OsLayerPreset.SettingKey.APPLIED_DEFAULTS, applied);
      } else {
        this.applyNone(id, presets);
      }
    }
  }

  /**
   *
   * @param {!string} id The layer ID.
   * @param {!osx.layer.Preset} preset The preset.
   */
  applyPreset(id, preset) {
    let [,, meta] = /** @type {!Array<*>} */ (this.presets_.entry(id));
    meta = /** @type {!LayerPresetsMetaData} */ (meta);
    meta.selected = preset;

    OsLayerPreset.setSavedPresetId(id, preset.id || null);
    OsLayerPreset.setSavedPresetClean(id, true);

    this.listenToLayerStyleChange(id, preset);

    // TODO move the work of the command into LPM
    var cmd = new VectorLayerPreset(id, preset);
    cmd.execute();
  }
}

goog.addSingletonGetter(LayerPresetManager);

// export it so it's used
LayerPresetManager.LayerPresetsMetaData = LayerPresetsMetaData;


exports = LayerPresetManager;
