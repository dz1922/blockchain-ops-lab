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
  {
    name: 'disk', // A4: free the leftover seed archive and journals, then grow the root volume online
    scenario: 'avax-disk',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('ssm avax-01')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('df -h /'));
    o.push(await T.cmd('journalctl -u avalanchego -n 4 --no-pager'));
    o.push(await T.cmd('du -h --max-depth=1 /home/ubuntu'));
    o.push(await T.cmd('du -sh /home/ubuntu/.avalanchego/db /var/log/journal'));
    o.push(await T.cmd('cat /root/.bash_history'));
    o.push(await T.cmd('rm /home/ubuntu/seed/mainnet-latest.tar.zst'));
    o.push(await T.cmd('journalctl --vacuum-size=500M | tail -2'));
    o.push(await T.cmd('df -h /'));
    await T.adv(90);
    o.push(await T.cmd('systemctl is-active avalanchego'));
    o.push(await T.cmd('exit')); o.push(await T.cmd('exit'));
    o.push(await T.cmd('aws ec2 describe-volumes --region us-east-1 --filters Name=attachment.instance-id,Values=i-0a1f3c5e7b9d24681 --output table'));
    o.push(await T.cmd("VOL=$(aws ec2 describe-volumes --region us-east-1 --filters Name=attachment.instance-id,Values=i-0a1f3c5e7b9d24681 | jq -r '.Volumes[0].VolumeId'); echo $VOL"));
    o.push(await T.cmd('aws ec2 modify-volume --region us-east-1 --volume-id $VOL --size 2000 | jq -r .VolumeModification.ModificationState'));
    o.push(await T.cmd('aws ec2 modify-volume --region us-east-1 --volume-id $VOL --size 2200'));
    await T.adv(120);
    o.push(await T.cmd("aws ec2 describe-volumes-modifications --region us-east-1 --volume-ids $VOL | jq -r '.VolumesModifications[0].ModificationState'"));
    o.push(await T.cmd('ssm avax-01')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('lsblk'));
    o.push(await T.cmd('resize2fs /dev/nvme0n1p1'));
    o.push(await T.cmd('growpart /dev/nvme0n1 1'));
    o.push(await T.cmd('resize2fs /dev/nvme0n1p1'));
    o.push(await T.cmd('df -h /'));
    await T.adv(900);
    return { out: o.join('\\n----\\n'), done: VSIM.w.done, result: VSIM.w.result, obj: VSIM.w.objState, viol: VSIM.w.violations, events: VSIM.w.events.map(e => VSIM.S.tr(e.html).replace(/<[^>]+>/g,'')).slice(-10) };
  })()`,
    expect: r => r.result && r.result.success ? [] : ['lab not completed'],
  },
  {
    name: 'diskTrap', // A4 trap: delete a table file from the chain database to make room
    scenario: 'avax-disk',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('ssm avax-01')); o.push(await T.cmd('sudo -i'));
    o.push(await T.cmd('ls /home/ubuntu/.avalanchego/db/mainnet/v1.4.5'));
    o.push(await T.cmd('rm /home/ubuntu/.avalanchego/db/mainnet/v1.4.5/3204198.ldb'));
    await T.adv(60);
    return { out: o.join('\\n----\\n'), viol: VSIM.w.violations };
  })()`,
    expect: r => r.viol && r.viol.db_files !== undefined ? [] : ['db_files not flagged'],
  },
  {
    name: 'period', // A5: read the P-Chain record, hold the avax-02 change, run the avax-01 change
    scenario: 'avax-period',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('gh pr list'));
    o.push(await T.cmd('gh pr view 522'));
    o.push(await T.cmd("curl -s -X POST --data '{\\"jsonrpc\\":\\"2.0\\",\\"id\\":1,\\"method\\":\\"platform.getCurrentValidators\\",\\"params\\":{}}' https://api.avax.network/ext/bc/P | jq '.result.validators[] | {nodeID, uptime, endTime}'"));
    o.push(await T.cmd("END=$(curl -s -X POST --data '{\\"jsonrpc\\":\\"2.0\\",\\"id\\":1,\\"method\\":\\"platform.getCurrentValidators\\",\\"params\\":{\\"nodeIDs\\":[\\"NodeID-MFrZFVCXPv5iCn6M9K6XduxGTYp891xXZ\\"]}}' https://api.avax.network/ext/bc/P | jq -r '.result.validators[0].endTime'); date -u -d @$END"));
    o.push(await T.cmd('echo "scale=4; (89.2508*52 + 100*4)/56" | bc'));
    o.push(await T.cmd('echo "scale=2; 0.0186*1344/100*60" | bc'));
    o.push(await T.cmd('gh pr edit 522 --add-label do-not-merge'));
    o.push(await T.cmd('gh pr merge 521'));
    o.push(await T.cmd('gh pr list'));
    await T.adv(3000);
    return { out: o.join('\\n----\\n'), done: VSIM.w.done, result: VSIM.w.result, obj: VSIM.w.objState, viol: VSIM.w.violations, events: VSIM.w.events.map(e => VSIM.S.tr(e.html).replace(/<[^>]+>/g,'')).slice(-10) };
  })()`,
    expect: r => r.result && r.result.success ? [] : ['lab not completed'],
  },
  {
    name: 'periodTrap', // A5 trap: merge the avax-02 change inside its period
    scenario: 'avax-period',
    steps: `(async () => {
    const o = [];
    o.push(await T.cmd('gh pr merge 522'));
    o.push(await T.cmd('ssm avax-02'));
    await T.adv(2400);
    return { out: o.join('\\n----\\n'), viol: VSIM.w.violations, proj: VSIM.S.networks.avalanche.helpers.projected(VSIM.w.nodes['avax-02']) };
  })()`,
    expect: r => r.viol && r.viol.forfeit !== undefined ? [] : ['forfeit not flagged'],
  },
  {
    name: 'run', // R1: follow every step of the guided lab, using each step's cmds
    scenario: 'avax-run',
    steps: `(async () => {
    const o = [];
    const hows = VSIM.S.scenarios.find(s => s.id === 'avax-run').steps.map(st => st.cmds || []);
    const H = VSIM.S.networks.avalanche.helpers, n = () => VSIM.w.nodes['avax-new'];
    for (let i = 0; i < hows.length; i++) {
      if (i === 5) { for (let k = 0; k < 40 && !H.bootDone(n()); k++) await T.adv(600, 60); }
      for (const cmd of hows[i]) o.push('$ ' + cmd + '\\n' + await T.cmd(cmd));
      await T.adv(30);
      o.push('-- after step ' + (i + 1) + ': stepIdx=' + VSIM.w.stepIdx);
    }
    await T.adv(60);
    return { out: o.join('\\n'), done: VSIM.w.done, result: VSIM.w.result, stepIdx: VSIM.w.stepIdx, viol: VSIM.w.violations, events: VSIM.w.events.map(e => VSIM.S.tr(e.html).replace(/<[^>]+>/g,'')).slice(-6) };
  })()`,
    expect: r => [...(r.result && r.result.success ? [] : ['lab not completed (stepIdx ' + r.stepIdx + ')']), ...(/command not found|syntax error|internal simulator error/.test(r.out || '') ? ['a command in a step\'s cmds did not run'] : [])],
  },
  {
    name: 'runApiTrap', // R1 trap: http-host 0.0.0.0 with 9650 open in ufw
    scenario: 'avax-run',
    steps: `(async () => {
    const o = [];
    const hows = VSIM.S.scenarios.find(s => s.id === 'avax-run').steps.map(st => st.cmds || []);
    for (const i of [0, 1, 2, 3, 4]) for (let cmd of hows[i]) { if (i === 3 && cmd.startsWith('echo')) cmd = cmd.replace('127.0.0.1', '0.0.0.0'); o.push('$ ' + cmd + '\\n' + await T.cmd(cmd)); }
    o.push(await T.cmd('ufw allow 9650/tcp'));
    o.push(await T.cmd('ss -tlnp'));
    await T.adv(60);
    o.push(await T.cmd('exit')); o.push(await T.cmd('exit'));
    o.push(await T.cmd('nc -zv 198.51.100.60 9650'));
    return { out: o.join('\\n'), viol: VSIM.w.violations, stepIdx: VSIM.w.stepIdx };
  })()`,
    expect: r => r.viol && r.viol.api_public !== undefined ? [] : ['api_public not flagged'],
  },
  {
    name: 'runEarlyTrap', // R1 trap: register while the node is still bootstrapping
    scenario: 'avax-run',
    steps: `(async () => {
    const o = [];
    const hows = VSIM.S.scenarios.find(s => s.id === 'avax-run').steps.map(st => st.cmds || []);
    for (const i of [0, 1, 2, 3, 4]) for (const cmd of hows[i]) o.push('$ ' + cmd + '\\n' + await T.cmd(cmd));
    o.push(await T.cmd(hows[5][1]));
    o.push(await T.cmd('exit')); o.push(await T.cmd('exit'));
    o.push(await T.cmd(hows[8][hows[8].length - 1]));
    await T.adv(60);
    return { out: o.join('\\n'), viol: VSIM.w.violations, stepIdx: VSIM.w.stepIdx };
  })()`,
    expect: r => r.viol && r.viol.early_register !== undefined ? [] : ['early_register not flagged'],
  },
];
