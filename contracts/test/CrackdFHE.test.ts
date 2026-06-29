import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";

/**
 * Exercises the confidential code-breaking engine against the fhEVM mock
 * coprocessor. Requires the @fhevm/hardhat-plugin mock network (the default
 * `hardhat` network when the plugin is installed).
 *
 * Secret code used throughout: [7, 3, 7, 1]
 *   guess [7,3,7,1] -> black=4 white=0 solved=1
 *   guess [7,7,3,1] -> black=2 (pos0,pos3) white=2 (the extra 7 + the 3)
 *   guess [1,1,1,1] -> black=1 (pos3) white=0
 */
describe("CrackdFHE", () => {
  const SECRET = [7, 3, 7, 1];

  async function setup() {
    const [setter, guesser] = await ethers.getSigners();
    const FHEc = await ethers.getContractFactory("CrackdFHE");
    const fhe = await FHEc.deploy();
    await fhe.waitForDeployment();
    const addr = await fhe.getAddress();

    const enc = await fhevm
      .createEncryptedInput(addr, setter.address)
      .add8(SECRET[0])
      .add8(SECRET[1])
      .add8(SECRET[2])
      .add8(SECRET[3])
      .encrypt();

    const tx = await fhe
      .connect(setter)
      .createGame(enc.handles, enc.inputProof);
    const rc = await tx.wait();
    const ev = rc!.logs.find((l: any) => l.fragment?.name === "GameCreated") as any;
    const gameId = ev.args.gameId;
    return { fhe, addr, setter, guesser, gameId };
  }

  async function pegsFor(guess: number[]) {
    const { fhe, addr, guesser, gameId } = await setup();
    await fhe.connect(guesser).submitGuess(gameId, guess);
    const fb = await fhe.getFeedback(gameId, guesser.address);
    const black = await fhevm.userDecryptEuint(FhevmType.euint8, fb.black, addr, guesser);
    const white = await fhevm.userDecryptEuint(FhevmType.euint8, fb.white, addr, guesser);
    const solved = await fhevm.userDecryptEuint(FhevmType.euint8, fb.solved, addr, guesser);
    return { black: Number(black), white: Number(white), solved: Number(solved) };
  }

  it("scores an exact crack as black=4, solved=1", async () => {
    expect(await pegsFor([7, 3, 7, 1])).to.deep.equal({ black: 4, white: 0, solved: 1 });
  });

  it("scores misplaced duplicates correctly (frequency-capped white pegs)", async () => {
    expect(await pegsFor([7, 7, 3, 1])).to.deep.equal({ black: 2, white: 2, solved: 0 });
  });

  it("does not over-count duplicate guess digits", async () => {
    expect(await pegsFor([1, 1, 1, 1])).to.deep.equal({ black: 1, white: 0, solved: 0 });
  });
});
