/* TEVA HQ data bridge — hooks Activity DataService to AvatarManager/Anim. */
(function (root) {
  'use strict';
  var Avm = root.TevaAvatarManager;
  var Anim = root.TevaAnim;
  var Act = root.TevaActivity;
  function DataBridge(scene) {
    this.scene = scene;
    this.manager = new Avm.Manager(scene);
    this.service = Act.DataService;
  }
  DataBridge.prototype.start = function () {
    var self = this;
    var s = this.service;
    s.setHandlers({
      onConfig: function () {},
      onAgents: function (agents) {
        // rebuild minimal if needed: update existing
        (agents || []).forEach(function (a) {
          if (self.manager.updateAgent) self.manager.updateAgent(a);
          else if (self.manager.entries[a.id]) self.manager.entries[a.id].agent = a;
        });
      },
      onTimeline: function () {},
      onEvent: function (evt) {
        var msg = evt && evt.message;
        if (msg && msg.recipient_agent_id) {
          self.manager.updateAgent({ id: msg.recipient_agent_id });
        }
      }
    });
    s.loadConfig();
    s.loadAgents();
    s.connectSSE();
    if (root.setInterval) root.setInterval(function () { s.loadAgents(); }, 5000);
    if (root.setInterval) root.setInterval(function () { self.manager.update(0.05, Date.now()); }, 50);
    return this;
  };
  root.TevaDataBridge = { DataBridge: DataBridge };
})(typeof window !== 'undefined' ? window : global);
