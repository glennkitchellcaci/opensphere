goog.module('plugin.track.TrackManager');
goog.module.declareLegacyNamespace();

const array = goog.require('ol.array');
const asserts = goog.require('goog.asserts');
const dispose = goog.require('goog.dispose');
const events = goog.require('ol.events');
const googArray = goog.require('goog.array');
const log = goog.require('goog.log');
const olExtent = goog.require('ol.extent');
const osColor = goog.require('os.color');
const osFeature = goog.require('os.feature');
const osObject = goog.require('os.object');
const osMap = goog.require('os.map');
const osStyle = goog.require('os.style');
const osTrack = goog.require('os.track');
const pluginTrack = goog.require('plugin.track');
const ConditionalDelay = goog.require('goog.async.ConditionalDelay');
const EventTarget = goog.require('goog.events.EventTarget');
const Fields = goog.require('os.Fields');
const MapContainer = goog.require('os.MapContainer');
const PlacesManager = goog.require('plugin.places.PlacesManager');
const RecordField = goog.require('os.data.RecordField');
const StyleField = goog.require('os.style.StyleField');
const StyleType = goog.require('os.style.StyleType');
const Throttle = goog.require('goog.async.Throttle');
const TimelineController = goog.require('os.time.TimelineController');
const TimeInstant = goog.require('os.time.TimeInstant');
const TimeRange = goog.require('os.time.TimeRange');
const TrackInteraction = goog.require('plugin.track.TrackInteraction');

const Logger = goog.requireType('goog.log.Logger');
const OlFeature = goog.requireType('ol.Feature');


/**
 * @type {string}
 * @const
 */
const PREDICTED_TRACK_LABEL = '(Predicted)';

/**
 * Manager for handling tracks that are being followed during animation.
 */
class TrackManager extends EventTarget {
  /**
   * Constructor.
   */
  constructor() {
    super();

    /**
     * The list tracks currently being followed.
     * @type {!Array<!OlFeature>}
     * @private
     */
    this.following_ = [];

    /**
     * The list of features that are in the current animation timeframe.
     * @type {!Array<!OlFeature>}
     * @private
     */
    this.activeTracks_ = [];

    /**
     * The map container instance
     * @type {MapContainer|undefined}
     * @private
     */
    this.mc_ = MapContainer.getInstance();

    /**
     * The timeline controller instance.
     * @type {TimelineController|undefined}
     * @private
     */
    this.tlc_ = TimelineController.getInstance();

    /**
     * Defers attempting to follow a segment if the view is not ready
     * @type {ConditionalDelay|undefined}
     * @private
     */
    this.mapReadyDelay_ = new ConditionalDelay(this.showActiveTracks_.bind(this));

    /**
     * Throttle for how often we move the camera for tracked segments
     * @type {Throttle|undefined}
     * @private
     */
    this.trackThrottle_ = new Throttle(this.onTrackThrottle_, 1500, this);

    /**
     * @type {number}
     * @protected
     */
    this.nextPredictedTrack = 0;
  }

  /**
   * @inheritDoc
   */
  disposeInternal() {
    dispose(this.mapReadyDelay_);
    this.mapReadyDelay_ = undefined;

    dispose(this.trackThrottle_);
    this.trackThrottle_ = undefined;

    this.following_.forEach(function(track) {
      events.unlisten(track, events.EventType.CHANGE, this.onFeatureValueChange_, this);
    }, this);

    this.following_.length = 0;
    this.activeTracks_.length = 0;

    this.mc_ = undefined;
    this.tlc_ = undefined;

    super.disposeInternal();
  }

  /**
   * Add the track(s) to the list of followed tracks
   *
   * @param {Array<OlFeature>} tracks
   */
  followTracks(tracks) {
    tracks.forEach(function(track) {
      if (track && !array.includes(this.following_, track)) {
        this.following_.push(track);
        events.listen(track, events.EventType.CHANGE, this.onFeatureValueChange_, this);
      }
    }, this);
  }

  /**
   * Remove the track(s) from the list of followed tracks
   *
   * @param {Array<OlFeature>} tracks
   */
  unfollowTracks(tracks) {
    tracks.forEach(function(track) {
      if (track) {
        events.unlisten(track, events.EventType.CHANGE, this.onFeatureValueChange_, this);

        googArray.removeIf(this.following_, function(item) {
          return item === track;
        });

        googArray.removeIf(this.activeTracks_, function(item) {
          return item === track;
        });

        // also need to remove it from the active tracks
        for (let k = 0; k < this.activeTracks_.length; k++) {
          if (this.activeTracks_[k] == track) {
            googArray.removeAt(this.activeTracks_, k);
          }
        }
      }
    }, this);
  }

  /**
   * Return whether a set of tracks is being followed.
   *
   * @param {Array<OlFeature>} tracks
   * @return {boolean} false if any of the tracks passed in are not followed
   */
  isFollowed(tracks) {
    for (let j = 0; j < tracks.length; j++) {
      if (!array.includes(this.following_, tracks[j])) {
        return false;
      }
    }

    return true;
  }

  /**
   * Called when track/feature change event is received
   *
   * @param {events.Event} event
   * @private
   */
  onFeatureValueChange_(event) {
    this.setActiveTracks_();

    // throttle the updates so that the movement doesn't get behind
    this.trackThrottle_.fire();
  }

  /**
   * Handle the track throttle event.
   *
   * @private
   */
  onTrackThrottle_() {
    if (this.mapReadyDelay_) {
      this.mapReadyDelay_.start(100, 5000);
    }
  }

  /**
   * Move the map to show active tracks.
   *
   * @return {boolean} If the operation succeeded, for use with `ConditionalDelay`.
   * @private
   */
  showActiveTracks_() {
    try {
      // if the map/view aren't ready, return false so the conditional delay will keep trying
      const view = this.mc_.getMap().getView();
      if (!view || !view.isDef()) {
        return false;
      }

      const resolution = view.getResolution();

      const viewExtent = this.mc_.getViewExtent();
      if (olExtent.equals(viewExtent, osMap.ZERO_EXTENT)) {
        return false;
      }

      if (this.mc_.getMap().isRendered()) {
        const extent = this.getActiveExtent(this.activeTracks_);

        if (!olExtent.isEmpty(extent) &&
            !olExtent.containsExtent(olExtent.buffer(viewExtent, -2), extent)) {
          asserts.assert(resolution != null, 'resolution should be defined');
          this.mc_.flyToExtent(extent, 5, this.mc_.resolutionToZoom(resolution));
        }
      }
    } catch (e) {
      log.error(TrackManager.LOGGER_, 'Error checking if map was ready:', e);
    }

    return true;
  }

  /**
   * Sets the list of active tracks to those that fall within the current timeline controller animation range.
   *
   * @private
   */
  setActiveTracks_() {
    // get the current animation range and determine which tracks are "active"
    const range = this.tlc_.getAnimationRange();
    const source = PlacesManager.getInstance().getPlacesSource();

    if (source) {
      // find any tracks that overlap the timerange
      const timeRange = new TimeRange(range.start, range.end);
      this.activeTracks_ = /** @type {!Array<!OlFeature>} */ (source.getTimeModel().intersection(
          timeRange, false, false));

      // check which of the active tracks are to be followed
      for (let i = 0; i < this.activeTracks_.length; i++) {
        if (!array.includes(this.following_, this.activeTracks_[i])) {
          googArray.removeAt(this.activeTracks_, i);
        }
      }
    }
  }

  /**
   * Generate an extent for all multiple tracks combined.
   *
   * @param {Array<OlFeature>} tracks
   * @return {ol.Extent}
   */
  getActiveExtent(tracks) {
    // generate the appropriate extent for the track(s) that are
    // active so that everything is appropriately shown
    const coordinates = [];
    if (tracks) {
      for (let i = 0; i < tracks.length; i++) {
        const trackPos = tracks[i].get(osTrack.TrackField.CURRENT_POSITION);
        if (trackPos) {
          coordinates.push(trackPos.getCoordinates());
        }
      }
    }

    return olExtent.boundingExtent(coordinates);
  }

  /**
   * Kick off TrackInteraction. Follow mouse until user clicks or types Esc
   *
   * @param {Array<!OlFeature>} tracks
   */
  promptForTrackPrediction(tracks) {
    const interaction = this.getTrackInteraction_();
    if (interaction) {
      const toggle = !interaction.getActive();
      if (toggle) {
        const track = tracks[tracks.length - 1];
        interaction.config(/** @type {pluginx.track.TrackOptions} */ ({
          callback: this.interactionCallback_.bind(this, interaction, track),
          track: track
        }));
      }
      interaction.setEnabled(toggle);
      interaction.setActive(toggle);
    }
  }

  /**
   * Append new coordinates to the track
   *
   * @param {!TrackInteraction} interaction
   * @param {!OlFeature} track
   * @param {Array<Array<number>>} coords
   */
  interactionCallback_(interaction, track, coords) {
    interaction.setEnabled(false);
    interaction.setActive(false);

    if (track && coords.length > 0) {
      const name = track.get(Fields.NAME) || track.get(Fields.NAME.toLowerCase());
      const isPredictedTrack = (name && name.indexOf(PREDICTED_TRACK_LABEL) >= 0);
      const coordinates = [];

      let alt = coords[0][2];
      let time;
      if (coords[0].length == 3) {
        time = track.get(RecordField.TIME);
        if (time instanceof TimeInstant) {
          time = time.getStart();
        } else if (time instanceof TimeRange) {
          time = time.getEnd();
        } else {
          time = /** @type {number} */ (time);
        }
        coords[0].push(time);
      } else {
        time = /** @type {number} */ (coords[0][3]);
      }

      for (let i = 1; i < coords.length; i++) {
        alt += 0; // TODO fix alt. for now, just repeat the starting altitude
        time += 3600000; // TODO fix time. for now, increment time by one hour

        // take the Lat/Lon from coord, but splice in altitude and time
        const coord = coords[i];
        if (coord) {
          coord.splice(2, 2, alt, time);
          coordinates.push(coord);
        }
      }

      if (isPredictedTrack) {
        osTrack.addToTrack({
          track,
          coordinates});
      } else {
        this.nextPredictedTrack++;

        let color = osColor.toRgbArray(osObject.unsafeClone(osFeature.getColor(track)));
        color[3] = .45;
        color = osStyle.toRgbaString(color);

        // add the end of the old track as the start of the predicted one
        coordinates.splice(0, 0, coords[0]);
        const newTrack = pluginTrack.createAndAdd({
          name: [PREDICTED_TRACK_LABEL, this.nextPredictedTrack, '|', (name || 'Track')].join(' '),
          includeMetadata: true,
          color,
          coordinates
        });
        if (newTrack) {
          const styles = osObject.unsafeClone(track.get(StyleType.FEATURE) || newTrack.get(StyleType.FEATURE));
          let style = styles;
          if (style) {
            if (Array.isArray(style)) {
              style = style[0];
            }
            // edit style stroke
            let stroke = style[StyleField.STROKE];
            if (!stroke) {
              stroke = osObject.unsafeClone(interaction.getStyle().getStroke()); // TODO convert ol.Style
            } else {
              stroke['color'] = color;
              stroke['width'] = 2;
              stroke['lineDash'] = osStyle.LINE_STYLE_OPTIONS[6].pattern;
            }
            style[StyleField.STROKE] = stroke;
            newTrack.set(StyleType.FEATURE, styles);
          }
        }
      }
    }
  }

  /**
   * @return {?TrackInteraction} The measure interaction
   * @private
   */
  getTrackInteraction_() {
    const interactions = this.mc_.getMap().getInteractions().getArray();
    const interaction = interactions.find((i) => {
      return (i instanceof TrackInteraction && i.isType('track')); // TODO constant
    });
    return /** @type {TrackInteraction} */ (interaction);
  }
}

goog.addSingletonGetter(TrackManager);


/**
 * Logger
 * @type {Logger}
 * @private
 * @const
 */
TrackManager.LOGGER_ = log.getLogger('plugin.track.TrackManager');


exports = TrackManager;
