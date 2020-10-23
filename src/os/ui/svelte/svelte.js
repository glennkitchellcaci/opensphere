
import '../ui.js'; // goog.provide() files dirty up the window scope
const osUI = os.ui; // TODO do this more cleanly

// TODO load the svelte components dynamically
import BufferDialog from '../buffer/BufferDialog.svelte';

/**
 * Simple wrapper for Svelte components
 * @unrestricted
 */
class Controller {
  /**
   * Constructor.
   * @param {!angular.Scope} $scope
   * @param {!angular.JQLite} $element
   */
  constructor($scope, $element) {
    /**
     * The map instance.
     * @type {function(new:Object, Object)|null}
     * @private
     */
    this.type_ = null;

    // TODO load the svelte components dynamically
    switch ($scope['type']) {
      default:
        this.type_ = BufferDialog;
        break;
    }

    // let angular settle before initializing
    osUI.waitForAngular(this.onAngularReady_.bind(this, $element));
  }

  /**
   * Angular $onDestroy lifecycle hook.
   */
  $onDestroy() {
    // TODO uninitialize the svelte component
  }

  /**
   * Initialize the map when Angular has finished loading the DOM.
   *
   * @param {!angular.JQLite} $element
   * @param {string=} opt_err Error message if a failure occurred.
   * @private
   */
  onAngularReady_($element, opt_err) {
    console.log('here', this, arguments);
    var Clazz = this.type_;
    try {
      new Clazz({
        target: $element[0]
      });
    } catch (e) {
      console.log(e);
    }
  }
}

/**
 * The svelte directive.
 * @return {angular.Directive}
 */
const directive = () => ({
  restrict: 'E',
  scope: true,
  replace: true,
  template: '<div></div>',
  controller: Controller,
  controllerAs: 'ctrl'
});

/**
 * Add the directive to the module.
 */
osUI.Module.directive('svelte', [directive]);


export {Controller, directive};
