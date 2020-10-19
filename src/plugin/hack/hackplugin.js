import Hack from './Hack.svelte';

const AbstractPlugin = goog.require('os.plugin.AbstractPlugin');


/**
 * @type {string}
 * @const
 */
const ID = 'hack';

/**
 * Plugin to read AreaData services configs into the registry for use by other plugins
 */
class HackPlugin extends AbstractPlugin {
  /**
   * constructor
   */
  constructor() {
    super();
    this.id = ID;

    // inits the svelte component
    new Hack({
      target: document.querySelector('#svelte-app')
    });
  }

  /**
   * @inheritDoc
   */
  init() {

  }
}


export default HackPlugin;
