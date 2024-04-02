/* eslint-disable no-await-in-loop */
import * as fs from "fs";
import * as path from "path";
import { getSigner } from "../utils";

import { BigNumber as BN } from "ethers";
import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";

import * as EthDater from "ethereum-block-by-date";
import { config } from "../../tasks/deploy/mainnet-config";

const nonCirculatingAddresses = [
    "0x5bd3fCA8D3d8c94a6419d85E0a76ec8Da52d836a", // AuraVestedEscrow
    "0x35f01bB40e5Bb9D0dC67E87937458f387e01A5C9", // AuraVestedEscrow
    "0x4fE41D1e1D9E73ED133299B13F4f7058446a56E2", // AuraVestedEscrow
    "0x1ab80F7Fb46B25b7e0B2cfAC23Fc88AC37aaf4e9", // Master Chef
    "0xfc78f8e1af80a3bf5a1783bb59ed2d1b10f78ca9", // GnosisSafeProxy - Treasury
    "0x21AED3a7A1c34Cd88B8A39DbDAE042bEfbf947ff", // GnosisSafeProxy - Incentives
    "0xab9ff9fbc44bb889751c4e70ad2f6977267a1e09", // GnosisSafeProxy
    "0x43B17088503F4CE1AED9fB302ED6BB51aD6694Fa", // AuraVestedEscrow - Treasury
    "0xFd72170339AC6d7bdda09D1eACA346B21a30D422", // AuraVestedEscrow - Vesting to Balancer
    "0x32DC5467ddA301Ce533C0720EcD913E1AA3C2267", // AuraVestedEscrow
    "0x38DB4dcFdD2fc1e2aB8EaaE5CdAa6f6CD6D89a5C", // AuraVestedEscrow
    "0x8Ea26bF9599cF5625a61367DB40d17194A24aC0B", // AuraVestedEscrow
    "0xC47162863a12227E5c3B0860715F9cF721651C0c", // AuraBalRewardPool - Initial auraBal Staking
    "0x24346652e0e2aE0CE05c781501fDF4Fe4553fAc6", // AuraVestedEscrow
    "0x45025Ebc38647bcf7Edd2b40CfDaF3fbfE1538F5", // AuraVestedEscrow
    "0x2AE1Ee55dfaDAC71EF5F25f093D2f24Fe58961f1", // AuraVestedEscrow
    "0x196bda3808A7Af322AaD6384103C1E6Adb40AFa7", // Ecosystem
    "0x3BC0Cb287f74504347D50fe3aDA6d90214E6F512", // Ecosystem
    "0x54231C588b698dc9B91303C95c85F050DA35189B", // GaugeVoteRewards
    "0x26094f9A6a498c1FCCd8Ff65829F55FB8BD72A4E", // GaugeVoteRewards
    "0x45EB1A004373b1D8457134A2C04a42d69D287724", // AuraAirdrop
];
function jsonToCsv(data: any[]) {
    const header = Object.keys(data[0]);
    const replacer = (__key, value) => (value === null ? "" : value); // specify how you want to handle null values here

    const csv = [
        header.join(","), // header row first

        ...data.map(row => header.map(fieldName => JSON.stringify(row[fieldName], replacer)).join(",")),
    ].join("\r\n");
    return csv;
}

task("info:aura:supply-circulation", "Gets weekly total supply vs total circulation").setAction(async function (
    __tskArgs: TaskArguments,
    hre: HardhatRuntimeEnvironment,
) {
    const signer = await getSigner(hre);
    const dater = new EthDater.default(hre.ethers.provider);
    type BlockRange = {
        date: string;
        block: number;
        timestamp: number;
    };
    const phase2 = await config.getPhase2(signer);
    const blocks: Array<BlockRange> = await dater.getEvery(
        "weeks", // Period, required. Valid value: years, quarters, months, weeks, days, hours, minutes
        "2024-03-07T07:00:00Z", // Start date, required. 2022-06-09T10:46:00Z <== Aura first Mint
        new Date(), // End date, required.
        1, // Duration, optional, integer. By default 1.
        true, // Block after, optional. Search for the nearest block before or after the given date. By default true.
        false, // Refresh boundaries, optional. Recheck the latest block before request. By default false.
    );
    const data = [];
    const sumBN = (prev: BN, curr: BN): BN => prev.add(curr);
    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        console.log(`date ${block.date}, ${i} out of ${blocks.length}`);

        const totalSupply = await phase2.cvx.totalSupply({ blockTag: block.block });
        const balanceOf = (address: string): Promise<BN> => phase2.cvx.balanceOf(address, { blockTag: block.block });

        const totalNonCirculatingSupply = (await Promise.all(nonCirculatingAddresses.map(balanceOf))).reduce(
            sumBN,
            BN.from(0),
        );
        const circulatingSupply = totalSupply.sub(totalNonCirculatingSupply);

        data.push({
            ...block,
            totalSupply: hre.ethers.utils.formatEther(totalSupply),
            circulatingSupply: hre.ethers.utils.formatEther(circulatingSupply),
        });
    }
    const csv = jsonToCsv(data);
    fs.writeFileSync(path.resolve(__dirname, "./aura_total_supply_circulating_supply.json"), JSON.stringify(data));
    fs.writeFileSync(path.resolve(__dirname, "./aura_total_supply_circulating_supply.csv"), csv);
});
