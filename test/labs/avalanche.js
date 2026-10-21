// Avalanche lab runs. Each case plays a scenario through the UI hooks; expect() returns failure messages.
module.exports = [
  {
    name: 'helicon', // Helicon deadline, merge the PR
    scenario: 'avax-helicon',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('gh pr view 477'));
    o.push(await T.cmd('ssm avax-01')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('systemctl status avalanchego | head -4'));
    o.push(await T.cmd('curl -s localhost:9650/ext/health | jq .healthy'));
    o.push(await T.cmd('journalctl -u avalanchego -n 3 --no-pager'));
    o.push(await T.cmd('NODE=$(curl -s -X POST --data \\'{"jsonrpc":"2.0","id":1,"method":"info.getNodeID"}\\' localhost:9650/ext/info | jq -r .result.nodeID); echo $NODE'));
    o.push(await T.cmd('curl -s -X POST --data "{\\\\"jsonrpc\\\\":\\\\"2.0\\\\",\\\\"id\\\\":1,\\\\"method\\\\":\\\\"platform.getCurrentValidators\\\\",\\\\"params\\\\":{\\\\"nodeIDs\\\\":[\\\\"$NODE\\\\"]}}" https://api.avax.network/ext/bc/P | jq ".result.validators[0] | {uptime, connected}"'));
    o.push(await T.cmd('cp /usr/local/bin/avalanchego /tmp/x && echo copied-to-tmp'));
    o.push(await T.cmd('exit')); o.push(await T.cmd('exit'));
    o.push(await T.cmd('staking upgrade avalanche --moniker avax-01 --version 1.15.0'));
    o.push(await T.cmd('gh pr merge 477'));
    await T.adv(5400);
    return { out: o.join('\\n----\\n'), done: VSIM.w.done, result: VSIM.w.result, obj: VSIM.w.objState, nodes: Object.values(VSIM.w.nodes).map(n => [n.moniker, n.av.running, n.av.offline]), events: VSIM.w.events.map(e => VSIM.S.tr(e.html).replace(/<[^>]+>/g,'')).slice(-14) };
  })()`,
    expect: r => r.result && r.result.success ? [] : ['lab not completed'],
  },
  {
    name: 'r2210', // Helicon 22:10 — staking upgrade per node (region trap first)
    scenario: 'avax-2210',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('ssm avax-02')); o.push(await T.cmd('sudo -i')); o.push(await T.cmd('systemctl status avalanchego | head -5'));
    o.push(await T.cmd('journalctl -u avalanchego -n 4 --no-pager | grep -i fatal'));
    o.push(await T.cmd('avalanchego --version'));
    o.push(await T.cmd('cd /tmp && curl -fsSL -o a.tar.gz https://github.com/ava-labs/avalanchego/releases/download/v1.15.0/avalanchego-linux-amd64-v1.15.0.tar.gz && tar xzf a.tar.gz -C /tmp/ && install -m 0755 -o root -g root /tmp/avalanchego-v1.15.0/avalanchego /usr/local/bin/avalanchego && echo installed'));
    await T.adv(60);
    o.push(await T.cmd('systemctl is-active avalanchego'));
    o.push(await T.cmd('exit')); o.push(await T.cmd('exit'));
    o.push(await T.cmd('staking upgrade avalanche --env prod --moniker avax-01 --version 1.15.0'));
    o.push(await T.cmd('staking --region us-east-1 upgrade avalanche --env prod --moniker avax-01 --version 1.15.0'));
    o.push(await T.cmd('staking --region us-west-1 upgrade avalanche --env prod --moniker avax-03 --version 1.15.0'));
    await T.adv(3000);
    return { out: o.join('\\n----\\n'), done: VSIM.w.done, result: VSIM.w.result, obj: VSIM.w.objState, viol: VSIM.w.violations, nodes: Object.values(VSIM.w.nodes).map(n => [n.moniker, n.av.running, n.services.avalanchego.state, n.services.avalanchego.restarts]) };
  })()`,
    expect: r => r.result && r.result.success ? [] : ['lab not completed'],
  },
  {
    name: 'ip', // avax-02 IP
    scenario: 'avax-ip',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('aws ssm start-session --target i-0b2e4d6f8a1c35792'));
    o.push(await T.cmd('aws ssm start-session --region us-west-2 --target i-0b2e4d6f8a1c35792'));
    o.push(await T.cmd('systemctl restart avalanchego'));
    o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('curl -s localhost:9650/ext/health | jq .checks.network.error'));
    o.push(await T.cmd('NEW=$(curl -s checkip.amazonaws.com); jq -r \\'."public-ip"\\' /etc/avalanche/config.json; echo $NEW'));
    o.push(await T.cmd('sed -i "s/198.51.100.12/$NEW/" /etc/avalanche/config.json && systemctl restart avalanchego'));
    o.push(await T.cmd('exit')); o.push(await T.cmd('exit'));
    o.push(await T.cmd('nc -zv 198.51.100.47 9651'));
    o.push(await T.cmd('cd ~/monitoring && sed -i "s/198.51.100.12/198.51.100.47/" ext-uptime/prometheus/prometheus.yml.tmpl && ./scripts/deploy-ext-uptime.sh'));
    await T.adv(1200);
    return { out: o.join('\\n----\\n'), done: VSIM.w.done, result: VSIM.w.result, obj: VSIM.w.objState };
  })()`,
    expect: r => r.result && r.result.success ? [] : ['lab not completed'],
  },
  {
    name: 'trap', // Helicon rollback trap: upgrade one node by hand then roll back
    scenario: 'avax-helicon',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('staking --region us-east-1 upgrade avalanche --env prod --moniker avax-01 --version 1.15.0'));
    o.push(await T.cmd('ssm avax-01')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('cp /usr/local/bin/avalanchego.prev /usr/local/bin/avalanchego'));
    o.push(await T.cmd('install -m 0755 /usr/local/bin/avalanchego.prev /usr/local/bin/avalanchego && systemctl restart avalanchego'));
    await T.adv(60);
    o.push(await T.cmd('journalctl -u avalanchego -n 6 --no-pager'));
    return { out: o.join('\\n----\\n'), viol: VSIM.w.violations, state: VSIM.w.nodes['avax-01'].services.avalanchego.state };
  })()`,
    expect: r => r.viol && r.viol.rollback !== undefined ? [] : ['rollback not flagged'],
  },
];
