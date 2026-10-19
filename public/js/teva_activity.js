/* TEVA HQ activity helpers — pure logic, no DOM. */
(function (root) {
  'use strict';

  function isDemo(config, agents) {
    config = config || {};
    if (config.mode === 'demo') return true;
    return Array.isArray(agents) && agents.some(function (a) {
      return a && (a.source === null || a.source === undefined) && a.signal === false;
    });
  }

  function provenanceLabel(event) {
    event = event || {};
    if (event.provenance === 'observed') return 'Observed';
    if (event.provenance === 'user') return 'Manual';
    if (event.source === 'simulated' || event.source === 'demo') return 'Simulated';
    if (event.source) return 'Reported';
    return 'Unknown';
  }

  function safeState(agent) {
    if (!agent) return 'unknown';
    var activity = agent.activity || {};
    if (activity.state) return activity.state;
    if (agent.status) return agent.status;
    return 'awaiting status';
  }

  root.TevaActivity = {
    isDemo: isDemo,
    provenanceLabel: provenanceLabel,
    safeState: safeState
  };
})(typeof window !== 'undefined' ? window : global);
