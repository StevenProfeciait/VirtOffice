/* TEVA HQ data bridge — hooks Activity DataService to AvatarManager/Anim. */
(function (root) {
  'use strict';
  var Act = root.TevaActivity;
  function DataBridge(scene, options) {
    options = options || {};
    this.scene = scene;
    this.manager = new root.TevaAvatarManager.Manager(scene);
    // Keep the modular renderer usable even when the optional live activity
    // service is unavailable (for example during a static-file preview).
    // The initial roster still renders and the bridge will use the same API
    // endpoints when they are available.
    this.service = Act && Act.DataService ? Act.DataService : {
      _handlers: {},
      setHandlers: function (handlers) { this._handlers = handlers || {}; },
      loadConfig: function () {
        return root.fetch ? root.fetch('/api/config').then(function (r) { return r.ok ? r.json() : {}; }).then(function (c) {
          if (this._handlers.onConfig) this._handlers.onConfig(c);
          return c;
        }.bind(this)) : Promise.resolve({});
      },
      loadAgents: function () {
        return root.fetch ? root.fetch('/api/agents').then(function (r) { return r.ok ? r.json() : []; }).then(function (agents) {
          agents = Array.isArray(agents) ? agents : (agents.agents || []);
          if (this._handlers.onAgents) this._handlers.onAgents(agents);
          return agents;
        }.bind(this)) : Promise.resolve([]);
      },
      connectSSE: function () {},
      disconnect: function () {}
    };
    this.positionResolver = options.positionResolver || function () { return { x: 0, z: 0 }; };
    this.onAgent = options.onAgent || null;
    this.quality = options.quality || 'full';
    this.manager.setQuality(this.quality);
    this.pollTimer = null;
    this.tickTimer = null;
  }
  DataBridge.prototype.reconcile = function (agents) {
    var self = this;
    var incoming = {};
    (agents || []).forEach(function (agent) {
      if (!agent || !agent.id) return;
      if (root.TevaAssets && root.TevaAssets.enrichAgent) agent = root.TevaAssets.enrichAgent(agent);
      incoming[agent.id] = true;
      var entry = self.manager.entries[agent.id];
      if (entry) self.manager.updateAgent(agent);
      else self.manager.addAgent(agent, self.positionResolver(agent) || { x: 0, z: 0 });
      if (agent.movement && agent.movement.destination && self.manager.moveAgent) {
        self.manager.moveAgent(agent.id, agent.movement.destination, { duration: agent.movement.duration, path: agent.movement.path });
      }
      if (self.onAgent) self.onAgent(agent, self.manager.entries[agent.id]);
    });
    Object.keys(self.manager.entries).forEach(function (id) {
      if (!incoming[id] && self.manager.removeAgent) self.manager.removeAgent(id);
    });
  };
  DataBridge.prototype.start = function () {
    var self = this;
    var s = this.service;
    s.setHandlers({
      onConfig: function () {},
      onAgents: function (agents) {
        self.reconcile(agents);
      },
      onTimeline: function () {},
      onEvent: function (evt) {
        var msg = evt && evt.message;
        if (msg && msg.recipient_agent_id) {
          var entry = self.manager.entries[msg.recipient_agent_id];
          if (entry) self.manager.updateAgent(entry.agent);
        }
      }
    });
    s.loadConfig();
    s.loadAgents();
    s.connectSSE();
    if (root.setInterval) this.pollTimer = root.setInterval(function () { s.loadAgents(); }, 5000);
    if (root.setInterval) this.tickTimer = root.setInterval(function () { self.manager.update(0.05, Date.now()); }, 50);
    return this;
  };
  DataBridge.prototype.stop = function () {
    if (this.pollTimer && root.clearInterval) root.clearInterval(this.pollTimer);
    if (this.tickTimer && root.clearInterval) root.clearInterval(this.tickTimer);
    this.pollTimer = this.tickTimer = null;
    if (this.service && this.service.disconnect) this.service.disconnect();
  };
  DataBridge.prototype.setQuality = function (quality) {
    this.quality = this.manager.setQuality(quality);
    return this.quality;
  };
  DataBridge.prototype.dispose = function () {
    this.stop();
    if (this.manager && this.manager.dispose) this.manager.dispose();
  };
  root.TevaDataBridge = { DataBridge: DataBridge };
})(typeof window !== 'undefined' ? window : global);
