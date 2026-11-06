import { test } from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory, parseUnits, ZeroAddress } from 'ethers';
import { compile } from '../compile.mjs';

test('BEP-20 supply, transfers, allowances and ownership invariants', async () => {
  const rpc = ganache.provider({ logging: { quiet: true }, chain: { chainId: 1337, hardfork: 'shanghai' } });
  try {
    const provider = new BrowserProvider(rpc);
    const treasury = await provider.getSigner(0);
    const user = await provider.getSigner(1);
    const spender = await provider.getSigner(2);
    const owner = await treasury.getAddress();
    const recipient = await user.getAddress();
    const artifact = compile();
    const factory = new ContractFactory(artifact.abi, artifact.evm.bytecode.object, treasury);
    // Fixture only: this quantity does not define the production tokenomics.
    const supply = parseUnits('1000', 18);
    const token = await factory.deploy('BTN', supply, owner);
    await token.waitForDeployment();
    assert.equal(await token.name(), 'BitNode');
    assert.equal(await token.symbol(), 'BTN');
    assert.equal(await token.decimals(), 18n);
    assert.equal(await token.getOwner(), owner);
    assert.equal(await token.totalSupply(), supply);
    assert.equal(await token.balanceOf(owner), supply);
    await (await token.transfer(recipient, 100n)).wait();
    assert.equal(await token.balanceOf(recipient), 100n);
    await (await token.connect(user).approve(await spender.getAddress(), 40n)).wait();
    await (await token.connect(spender).transferFrom(recipient, owner, 40n)).wait();
    assert.equal(await token.balanceOf(recipient), 60n);
    assert.equal(await token.allowance(recipient, await spender.getAddress()), 0n);
    await assert.rejects(async () => (await token.connect(spender).transferFrom(recipient, owner, 1n)).wait());
    await assert.rejects(async () => (await token.connect(user).transfer(owner, 61n)).wait());
    await assert.rejects(async () => (await token.transfer(ZeroAddress, 1n)).wait());
    await assert.rejects(async () => (await token.connect(user).transferOwnership(recipient)).wait());
    await (await token.transferOwnership(recipient)).wait();
    assert.equal(await token.getOwner(), recipient);
    assert.equal(await token.totalSupply(), supply);
    assert.equal(await token.balanceOf(owner) + await token.balanceOf(recipient), supply);
    assert.ok(!artifact.abi.some(item => item.type === 'function' && /mint|seize|setTax|upgrade/i.test(item.name)));
    await assert.rejects(async () => (await factory.deploy('BTN', 0n, owner)).waitForDeployment());
    await assert.rejects(async () => (await factory.deploy('', supply, owner)).waitForDeployment());
    await assert.rejects(async () => (await factory.deploy('BTN', supply, ZeroAddress)).waitForDeployment());
  } finally {
    await rpc.disconnect();
  }
});
