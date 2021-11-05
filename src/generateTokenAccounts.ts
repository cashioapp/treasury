import type { ArrowData } from "@arrowprotocol/arrow";
import { generateArrowAddress, parseArrow } from "@arrowprotocol/arrow";
import { BANK_KEY, CRATE_TOKEN } from "@cashio/cashio";
import { SignerWallet, SolanaProvider } from "@saberhq/solana-contrib";
import { getATAAddress } from "@saberhq/token-utils";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs/promises";
import { groupBy, mapValues, zip } from "lodash";

/**
 * The mints of the tokens in the treasury.
 */
const MAINNET_ARROW_MINTS = [
  // USDC-USDT
  "USD9oeJpVZ8XXF9L884ZEsw7VXTSguNXboxsEi1fHrE",
].map((m) => new PublicKey(m));

/**
 * Known tokens that will be in the Bank as rewards.
 * Value is the coingecko ID.
 */
const KNOWN_REWARDS_TOKENS: Record<string, string> = {
  // SUNNY IOU
  SRYWvj5Xw1UoivpdfJN4hFZU1qbtceMvfM5nBc3PsRC: "sunny-aggregator",
  // SBR IOU
  iouQcQBAiEXe6cKLS85zmZxUqaCqBdeHFpqKoSz615u: "saber",
};

const fetchAccounts = async (
  mints: PublicKey[],
  owner: PublicKey,
  arrows: {
    key: PublicKey;
    data: ArrowData;
  }[]
) => {
  return await Promise.all(
    mints.map(async (mint) => {
      return {
        mint,
        account: await getATAAddress({
          mint,
          owner,
        }),
        coingeckoID: KNOWN_REWARDS_TOKENS[mint.toString()],
        sunnyPoolKey: arrows.find((arrow) => arrow.data.mint.equals(mint))?.data
          .pool,
      };
    })
  );
};

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

  const bankAccounts = await fetchAccounts(
    [
      ...MAINNET_ARROW_MINTS,
      ...Object.keys(KNOWN_REWARDS_TOKENS).map((k) => new PublicKey(k)),
    ],
    BANK_KEY,
    arrows
  );

  const crateAccounts = await fetchAccounts(
    MAINNET_ARROW_MINTS,
    CRATE_TOKEN,
    arrows
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

  // aggregate
  const allAccounts = [...bankAccounts, ...crateAccounts];
  const coingeckoTokens = mapValues(
    groupBy(
      allAccounts.filter((k) => k.coingeckoID),
      (k) => k.coingeckoID
    ),
    (v) => v.map((a) => a.account)
  );
  const sunnyPools = mapValues(
    groupBy(
      allAccounts.filter((k) => !k.coingeckoID && k.sunnyPoolKey),
      (k) => k.sunnyPoolKey
    ),
    (v) => v.map((a) => a.account)
  );

  await fs.writeFile(
    "data/token-accounts.json",
    JSON.stringify(
      {
        coingeckoTokens,
        sunnyPools,
      },
      (_, v: unknown) => {
        if (v instanceof PublicKey) {
          return v.toString();
        }
        return v;
      }
    )
  );
  console.log(`Discovered and wrote ${allAccounts.length} accounts.`);
};

generateTokenAccounts().catch((err) => {
  console.error(err);
});
