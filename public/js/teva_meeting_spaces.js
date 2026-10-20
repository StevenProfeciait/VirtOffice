/**
 * Resolve which collab/meeting space an agent uses (layout-driven, testable in Node).
 */
(function (root) {
  'use strict';

  function getLayout() {
    return root.LAYOUT || root.OFFICE_LAYOUT || {};
  }

  function meetingSpacesMap() {
    var L = getLayout();
    return L.meetingSpaces || {};
  }

  function resolveMeetingSpace(agent) {
    agent = agent || {};
    var spaces = meetingSpacesMap();
    var explicit = agent.meetingSpace || agent.collabSpace
      || (agent.avatar && (agent.avatar.meetingSpace || agent.avatar.collabSpace));
    if (explicit && spaces[explicit]) return spaces[explicit];

    var id = String(agent.id || agent.home || '');
    var keys = Object.keys(spaces);
    for (var i = 0; i < keys.length; i++) {
      var space = spaces[keys[i]];
      if (!space || space.type === 'fun') continue;
      var ids = space.agentIds || [];
      if (ids.indexOf(id) >= 0) return space;
    }
    return spaces.main || { id: 'main', x: 0, z: -15.5, radius: 3, chairs: 6 };
  }

  function meetingSlotForAgent(agent, agentsInMeeting) {
    var space = resolveMeetingSpace(agent);
    var id = String(agent.id || '');
    var sameSpace = (agentsInMeeting || []).filter(function (a) {
      return resolveMeetingSpace(a).id === space.id;
    });
    var ids = sameSpace.map(function (a) { return a.id; });
    var k = Math.max(0, ids.indexOf(id));
    var chairCount = Math.max(1, space.chairs || 6);
    var ang = (k % chairCount) / chairCount * Math.PI * 2 + (k >= chairCount ? Math.PI / 6 : 0);
    var r = (space.radius || 3) + (k >= chairCount ? 0.9 : 0);
    var tx = Number(space.x) || 0;
    var tz = Number(space.z) || 0;
    return { x: Math.cos(ang) * r + tx, z: Math.sin(ang) * r + tz, space: space };
  }

  root.TevaMeetingSpaces = {
    resolveMeetingSpace: resolveMeetingSpace,
    meetingSlotForAgent: meetingSlotForAgent,
    meetingSpacesMap: meetingSpacesMap
  };
})(typeof window !== 'undefined' ? window : global);
