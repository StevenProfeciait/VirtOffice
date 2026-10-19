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
    safeState: safeState,
    computeDisplay: computeDisplay
  };

  function computeDisplay(agent) {
    var activity = (agent && agent.activity) || {};
    var base = TevaAvatars ? TevaAvatars.stateFromActivity(agent) : safeState(agent);
    var source = activity.source || agent.source || 'server';
    var provenance = activity.provenance || agent.provenance || 'server';
    var observed = provenance === 'observed' || source === 'cursor' || source === 'observed';
    return {
      state: base,
      task: (activity.task || agent.task || activity.label || agent.status || ''),
      lastActivity: activity.lastActivity || activity.updatedAt || agent.updatedAt || null,
      source: source,
      provenance: provenance,
      observed: observed,
      demo: source === 'simulated' || source === 'demo' || agent.signal === false
    };
  }
})(typeof window !== 'undefined' ? window : global);

/* TEVA HQ live data service — polls API, listens to SSE, caches timelines. */
(function (root) {
  'use strict';
  var req = root.fetch.bind(root);
  var Ev = root.EventSource;
  var svc = {
    config: null,
    agents: [],
    timelines: {},
    _src: null,
    _onAgents: null,
    _onTimeline: null,
    _onConfig: null,
    _onEvent: null
  };

  function json(url, opts) {
    return req(url, opts || {}).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
      return r.json();
    });
  }

  svc.setHandlers = function (h) {
    svc._onAgents = h.onAgents;
    svc._onTimeline = h.onTimeline;
    svc._onConfig = h.onConfig;
    svc._onEvent = h.onEvent;
  };

  svc.loadConfig = function () {
    return json('/api/config').then(function (c) {
      svc.config = c;
      if (svc._onConfig) svc._onConfig(c);
      return c;
    });
  };

  svc.loadAgents = function () {
    return json('/api/agents').then(function (data) {
      svc.agents = Array.isArray(data) ? data : (data.agents || []);
      if (svc._onAgents) svc._onAgents(svc.agents);
      return svc.agents;
    });
  };

  svc.loadTimeline = function (agentId, limit) {
    return json('/api/agents/' + encodeURIComponent(agentId) + '/timeline?limit=' + (limit || 50)).then(function (d) {
      svc.timelines[agentId] = (d && d.events) || [];
      if (svc._onTimeline) svc._onTimeline(agentId, svc.timelines[agentId]);
      return svc.timelines[agentId];
    });
  };

  svc.connectSSE = function (onMessage) {
    if (!Ev) return null;
    if (svc._src) svc._src.close();
    var src = new Ev('/events');
    svc._src = src;
    src.onmessage = function (e) {
      try {
        var data = JSON.parse(e.data);
        if (svc._onEvent) svc._onEvent(data);
        if (onMessage) onMessage(data);
      } catch (err) { /* ignore malformed SSE line */ }
    };
    src.onerror = function () { if (svc._src === src) svc._src = null; };
    return src;
  };

  svc.disconnect = function () {
    if (svc._src) { svc._src.close(); svc._src = null; }
  };

  root.TevaActivity.DataService = svc;
})((typeof window !== 'undefined' ? window : global));
