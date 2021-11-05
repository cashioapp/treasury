import type { ArrowData } from "@arrowprotocol/arrow";
import { generateArrowAddress, parseArrow } from "@arrowprotocol/arrow";
import { BANK_KEY, CRATE_TOKEN } from "@cashio/cashio";
import { SignerWallet, SolanaProvider } from "@saberhq/solana-contrib";
import { getATAAddress } from "@saberhq/token-utils";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs/promises";
import { zip } from "lodash";

/**
 * The mints of the tokens in the treasury.
 */
const MAINNET_ARROW_MINTS = [
  // USDC-USDT
  "USD9oeJpVZ8XXF9L884ZEsw7VXTSguNXboxsEi1fHrE",
].map((m) => new PublicKey(m));

/**
 * Known tokens that will be in the Bank as rewards.
 */
const KNOWN_REWARDS_TOKENS = [
  "SRYWvj5Xw1UoivpdfJN4hFZU1qbtceMvfM5nBc3PsRC",
  "iouQcQBAiEXe6cKLS85zmZxUqaCqBdeHFpqKoSz615u",
].map((v) => new PublicKey(v));

export const generateTokenAccounts = async (): Promise<void> => {
  const provider = SolanaProvider.load({
    connection: new Connection("https://calvin.rpcpool.com"),
    wallet: new SignerWallet(Keypair.generate()),
  });

  const arrowKeys = await Promise.all(
    MAINNET_ARROW_MINTS.map(async (mint) => {
      const [arrow] = await generateArrowAddress(mint);
      return arrow;
    })
  );
  const arrowsData = await provider.connection.getMultipleAccountsInfo(
    arrowKeys
  );
  const arrows = zip(arrowKeys, arrowsData)
    .map(([arrowKey, arrowData]) => {
      if (!arrowKey || !arrowData) {
        return null;
      }
      return {
        key: arrowKey,
        data: parseArrow({
          accountId: arrowKey,
          accountInfo: arrowData,
        }),
      };
    })
    .filter((x): x is { key: PublicKey; data: ArrowData } => !!x);

  const bankAccounts = await Promise.all(
    [...MAINNET_ARROW_MINTS, ...KNOWN_REWARDS_TOKENS].map(async (mint) => {
      return {
        mint,
        account: await getATAAddress({
          mint,
          owner: BANK_KEY,
        }),
        sunnyPoolKey: arrows.find((arrow) => arrow.data.mint.equals(mint))?.data
          .pool,
      };
    })
  );

  const crateAccounts = await Promise.all(
    MAINNET_ARROW_MINTS.map(async (mint) => {
      return {
        mint,
        account: await getATAAddress({
          mint,
          owner: CRATE_TOKEN,
        }),
        sunnyPoolKey: arrows.find((arrow) => arrow.data.mint.equals(mint))?.data
          .pool,
      };
    })
  );

  await fs.mkdir("data/", { recursive: true });
  await fs.writeFile(
    "data/arrow-mints.json",
    JSON.stringify(MAINNET_ARROW_MINTS, (_, v: unknown) => {
      if (v instanceof PublicKey) {
        return v.toString();
      }
      return v;
    })
  );
  await fs.writeFile(
    "data/token-accounts.json",
    JSON.stringify([...bankAccounts, ...crateAccounts], (_, v: unknown) => {
      if (v instanceof PublicKey) {
        return v.toString();
      }
      return v;
    })
  );
  console.log(
    `Discovered and wrote ${
      bankAccounts.length + crateAccounts.length
    } accounts.`
  );
};

generateTokenAccounts().catch((err) => {
  console.error(err);
});
