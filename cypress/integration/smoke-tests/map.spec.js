/// <reference types="Cypress" />
var opensphere = require('../../support/selectors/opensphere.js');

describe('Map controls', function() {
  before('Login', function() {
    cy.login();
  });

  // Note: 3D tests not supported in CI environment
  describe('2D Tests', function() {
    before('Ensure map is in 2D mode', function() {
      cy.get(opensphere.Map.MAP_MODE_BUTTON).should('contain', '2D');
    });

    it('Map overview', function() {
      // Setup
      cy.get(opensphere.Map.OVERVIEW_MAP).should('be.visible');

      // Test
      cy.get(opensphere.Map.OVERVIEW_MAP_TOGGLE_BUTTON).click();
      cy.get(opensphere.Map.OVERVIEW_MAP).should('not.be.visible');

      // Clean up
      cy.get(opensphere.Map.OVERVIEW_MAP_TOGGLE_BUTTON).click();
      cy.get(opensphere.Map.OVERVIEW_MAP).should('be.visible');
    });

    // TODO: Finish test after mouse interactions with the map are working.
    // https://github.com/cypress-io/cypress/issues/2768
    it.skip('Navigate via overview', function() {
      // Setup
      // <Enter setup steps here>

      // Test
      // <Enter test steps here>

      // Clean up
      // <Enter clean up steps here>
    });

    it('Zoom', function() {
      // Setup
      cy.get(opensphere.Application.PAGE).type('v');
      cy.get(opensphere.statusBar.ZOOM_TEXT).should('contain', 'Zoom:');

      // Test
      cy.get(opensphere.statusBar.ZOOM_TEXT).then(function($zoom) {
        var INITIAL_ZOOM = $zoom.text();
        cy.get(opensphere.Map.ZOOM_IN_BUTTON)
            .click()
            .click()
            .click()
            .click()
            .click();
        cy.get(opensphere.statusBar.ZOOM_TEXT).should('not.contain', INITIAL_ZOOM);
      });

      cy.get(opensphere.statusBar.ZOOM_TEXT).then(function($zoom) {
        var INITIAL_ZOOM = $zoom.text();
        cy.get(opensphere.Map.ZOOM_OUT_BUTTON)
            .click()
            .click()
            .click()
            .click()
            .click();
        cy.get(opensphere.statusBar.ZOOM_TEXT).should('not.contain', INITIAL_ZOOM);
      });
    });
  });
});
