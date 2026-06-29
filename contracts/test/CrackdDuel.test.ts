import { expect } from "chai";
import { ethers } from "hardhat";

describe("CrackdDuel", () => {
  async function deploy() {
    const [admin, p1, p2] = await ethers.getSigners();
    const Mock = await ethers.getContractFactory("MockERC20");
    const token = await Mock.deploy("Mock USDC", "USDC", 6);
    await token.waitForDeployment();

    const minStake = ethers.parseUnits("1", 6);
    const Duel = await ethers.getContractFactory("CrackdDuel");
    const duel = await Duel.deploy(admin.address, minStake);
    await duel.waitForDeployment();

    const stake = ethers.parseUnits("10", 6);
    for (const p of [p1, p2]) {
      await token.mint(p.address, stake * 10n);
      await token.connect(p).approve(await duel.getAddress(), stake * 10n);
    }
    return { admin, p1, p2, token, duel, stake };
  }

  it("runs a full create → join → declareWinner flow with 2.5% fee", async () => {
    const { admin, p1, p2, token, duel, stake } = await deploy();
    const tokenAddr = await token.getAddress();

    const tx = await duel.connect(p1).createGame(tokenAddr, stake);
    const rc = await tx.wait();
    const ev = rc!.logs.find((l: any) => l.fragment?.name === "GameCreated") as any;
    const gameId = ev.args.gameId;

    await duel.connect(p2).joinGame(gameId);

    const before = await token.balanceOf(p1.address);
    await duel.connect(admin).declareWinner(gameId, p1.address);
    const after = await token.balanceOf(p1.address);

    const pot = stake * 2n;
    const fee = (pot * 250n) / 10_000n;
    expect(after - before).to.equal(pot - fee);
    expect(await duel.getTreasuryBalance(tokenAddr)).to.equal(fee);
  });

  it("refunds player one on cancel", async () => {
    const { p1, token, duel, stake } = await deploy();
    const tokenAddr = await token.getAddress();
    const before = await token.balanceOf(p1.address);
    const tx = await duel.connect(p1).createGame(tokenAddr, stake);
    const rc = await tx.wait();
    const ev = rc!.logs.find((l: any) => l.fragment?.name === "GameCreated") as any;
    await duel.connect(p1).cancelGame(ev.args.gameId);
    expect(await token.balanceOf(p1.address)).to.equal(before);
  });

  it("rejects below-minimum stakes", async () => {
    const { p1, token, duel } = await deploy();
    await expect(
      duel.connect(p1).createGame(await token.getAddress(), ethers.parseUnits("0.5", 6)),
    ).to.be.revertedWithCustomError(duel, "BelowMinimumStake");
  });
});
