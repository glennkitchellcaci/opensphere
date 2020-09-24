goog.provide('os.im.action');
goog.provide('os.im.action.ImportActionCallbackConfig');
goog.provide('os.im.action.TagName');


/**
 * Identifier for import action components.
 * @type {string}
 * @const
 */
os.im.action.ID = 'importAction';


/**
 * Icon to represent import actions.
 * @type {string}
 * @const
 */
os.im.action.ICON = 'fa-magic';


/**
 * Timeline metrics tracked by OpenSphere.
 * @enum {string}
 */
os.im.action.Metrics = {
  COPY: 'importAction.copy',
  CREATE: 'importAction.create',
  EDIT: 'importAction.edit',
  EXPORT: 'importAction.export',
  IMPORT: 'importAction.import',
  REMOVE: 'importAction.remove'
};


/**
 * XML tags used by import actions.
 * @enum {string}
 */
os.im.action.TagName = {
  ACTIONS: 'actions',
  IMPORT_ACTIONS: 'importActions',
  IMPORT_ACTION: 'importAction'
};


/**
 * @typedef {{
 *  color: (Array<Iterable>|undefined),
 *  labelUpdateShown: boolean,
 *  notifyStyleChange: boolean,
 *  setColor: boolean,
 *  setFeaturesStyle: boolean
 * }}
 */
os.im.action.ImportActionCallbackConfig;


/**
 * Sort import actions by label.
 *
 * @param {os.im.action.IImportAction} a First action.
 * @param {os.im.action.IImportAction} b Second action.
 * @return {number} Sort order of the actions, by label.
 */
os.im.action.sortByLabel = function(a, b) {
  var aLabel = a ? a.getLabel() : '';
  var bLabel = b ? b.getLabel() : '';
  return goog.array.defaultCompare(aLabel, bLabel);
};


/**
 * Get columns from a filterable.
 *
 * @param {os.filter.IFilterable} filterable
 * @return {Array<os.ogc.FeatureTypeColumn>} columns of the  filterable
 */
os.im.action.getColumnsFromFilterable = function(filterable) {
  var columns = null;

  if (filterable instanceof os.layer.Vector) {
    var source = /** @type {os.source.ISource} */ (filterable.getSource());
    columns = os.source.getFilterColumns(source, true, true);
    columns = columns.map(os.source.definitionsToFeatureTypes);
  } else {
    columns = filterable.getFilterColumns();
  }

  return columns;
};
