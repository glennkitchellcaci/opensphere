<script>
  import '../../config/settings.js'; //goog.provide() files dirty up the window scope
  const Settings = os.config.Settings; // TODO do this more cleanly

  const loading = false; // TODO
  const disableConfirm = false; // TODO

  function cancel() {
    console.log("cancel");
  }

  function confirm() {
    console.log("confirm");
  }

</script>

<div class="d-flex flex-column">
  <div class="modal-body">
    <div ng-form="bufferDialogForm">
      <bufferform config="config" init-sources="sources" show-source-picker="buffer.showSourcePicker" warning-message="buffer.warningMessage"></bufferform>
    </div>
  </div>
  <div class="modal-footer">
    <button class="btn btn-primary" on:click={confirm} disabled={disableConfirm ? 'disabled' : ''}>
      <i class={loading ? 'fa fa-spin fa-spinner' : 'fa fa-check'}></i>
      {loading ? 'Loading' : 'OK'}
    </button>
    <button class="btn btn-secondary" on:click={cancel}>
      <i class="fa fa-ban"></i>
      Cancel
    </button>
  </div>
</div>
