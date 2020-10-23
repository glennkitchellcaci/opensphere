<script>
  import '../../config/settings.js'; //goog.provide() files dirty up the window scope
  const Settings = os.config.Settings; // TODO do this more cleanly

  console.log("created a buffer dialog.", Settings.getInstance());
</script>

<div class="d-flex flex-column">
  <div class="modal-body">
    <p>Buffer Dialog! Wooo!</p>
  </div>
</div>
