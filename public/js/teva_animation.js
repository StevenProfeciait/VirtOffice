/* TEVA HQ animation utilities — state aliases and mixer-safe transitions. */
(function (root) {
  'use strict';
  var ALIASES = {
    WORKING: ['seated_typing', 'typing', 'working', 'seated_idle', 'idle'],
    RESEARCHING: ['reading', 'seated_idle', 'idle'],
    TESTING: ['seated_typing', 'working', 'seated_idle', 'idle'],
    WAITING: ['seated_idle', 'idle'],
    PLANNING: ['talking', 'gesturing', 'seated_idle', 'idle'],
    ERROR: ['seated_idle', 'idle'],
    COMPLETED: ['celebrate', 'seated_idle', 'idle'],
    IDLE: ['seated_idle', 'idle'],
    WALKING: ['walking', 'walk', 'run']
  };
  function candidates(state) { return (ALIASES[String(state || 'IDLE').toUpperCase()] || ['idle']).slice(); }
  function transition(mixer, current, clip, duration) {
    if (!mixer || !clip) return current || null;
    var action = mixer.clipAction(clip);
    if (current && current.getClip && current.getClip() === clip) return current;
    if (current && current.fadeOut) current.fadeOut(duration || 0.2);
    action.reset();
    if (action.fadeIn) action.fadeIn(duration || 0.2);
    action.play();
    return action;
  }
  root.TevaAnim = root.TevaAnim || {
    aliases: ALIASES,
    candidates: candidates,
    transition: transition,
    update: function (mixer, dt) { if (mixer && mixer.update) mixer.update(dt || 0); },
    dispose: function (mixer) { if (mixer && mixer.stopAllAction) mixer.stopAllAction(); }
  };
})(typeof window !== 'undefined' ? window : global);
