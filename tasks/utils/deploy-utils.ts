import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Contract, ContractFactory, ContractReceipt, ContractTransaction, Overrides, ethers } from "ethers";
import { formatUnits } from "@ethersproject/units";

import { Create2Factory } from "../../types";
import { ExtSystemConfig } from "../../scripts/deploySystem";
import { getAddress } from "@ethersproject/address";
import { keccak256 as solidityKeccak256 } from "@ethersproject/solidity";
import { BytesLike } from "@ethersproject/bytes";

interface Create2Options {
    amount?: number;
    salt?: string;
    callbacks?: Array<BytesLike>;
}

interface DeployCreate2Options {
    overrides?: Overrides;
    create2Options?: Create2Options;
    debug?: boolean;
    waitForBlocks?: number | undefined;
}

export const deployContract = async <T extends Contract>(
    _: HardhatRuntimeEnvironment,
    contractFactory: ContractFactory,
    contractName = "Contract",
    constructorArgs: Array<unknown> = [],
    overrides: Overrides = {},
    debug = true,
    waitForBlocks = undefined,
): Promise<T> => {
    const contract = (await contractFactory.deploy(...constructorArgs, overrides)) as T;
    if (debug) {
        console.log(
            `\nDeploying ${contractName} contract with hash ${contract.deployTransaction.hash} from ${
                contract.deployTransaction.from
            } with:\nmaxPriorityFeePerGas ${
                (contract.deployTransaction.maxPriorityFeePerGas?.toNumber() || 0) / 1e9
            } Gwei\nmaxFeePerGas ${(contract.deployTransaction.maxFeePerGas?.toNumber() || 0) / 1e9} Gwei`,
        );
    }

    const receipt = await contract.deployTransaction.wait(waitForBlocks);
    const txCost = receipt.gasUsed.mul(contract.deployTransaction.gasPrice || 0);
    const abiEncodedConstructorArgs = contract.interface.encodeDeploy(constructorArgs);

    if (debug) {
        console.log(
            `\nDeployed ${contractName} to ${contract.address} in block ${receipt.blockNumber}, using ${
                receipt.gasUsed
            } gas costing ${formatUnits(txCost)} ETH`,
        );
        console.log(`ABI encoded args: ${abiEncodedConstructorArgs.slice(2)}`);
    }

    return contract;
};

export const deployContractWithCreate2 = async <T extends Contract, F extends ContractFactory>(
    hre: HardhatRuntimeEnvironment,
    create2Factory: Create2Factory,
    contractFactory: F,
    contractName: string,
    constructorArgs: Array<unknown> = [],
    options: DeployCreate2Options = {
        overrides: {},
        create2Options: { amount: 0, salt: undefined, callbacks: [] },
        debug: true,
        waitForBlocks: undefined,
    },
): Promise<T> => {
    const { overrides, create2Options, debug, waitForBlocks } = options;

    const salt = create2Options?.salt ?? contractName;
    if (debug) console.log("deployContractWithCreate2", contractName, "salt", salt);

    const create2DeployerAddress = create2Factory.address;
    const unsignedTx = contractFactory.getDeployTransaction(...constructorArgs, overrides ?? {});

    const create2Salt = solidityKeccak256(["string"], [salt]);
    const contractAddress = _computeCreate2Address(create2DeployerAddress, create2Salt, unsignedTx.data);
    const deployTransaction = await create2Factory.deploy(
        create2Options?.amount ?? 0,
        create2Salt,
        unsignedTx.data,
        create2Options?.callbacks ?? [],
        overrides ?? {},
    );
    const receipt = await deployTransaction.wait(waitForBlocks);
    const deployedEvent = receipt.events.find((e: any) => {
        return e.topics[0] === ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Deployed(bytes32,address)"));
    });
    const deployedAddress = deployedEvent.args["deployed"];
    if (deployedAddress.toLowerCase() !== contractAddress.toLowerCase())
        throw new Error(`Deployed address ${deployedAddress}, expected address ${contractAddress}`);

    const contract = new ethers.Contract(contractAddress, contractFactory.interface).connect(
        contractFactory.signer,
    ) as T;
    if (debug) {
        console.log(
            `\nDeploying ${contractName} contract with hash ${deployTransaction.hash} from ${
                deployTransaction.from
            } with gas price ${deployTransaction.gasPrice?.toNumber() || 0 / 1e9} Gwei`,
        );
    }
    const txCost = receipt.gasUsed.mul(deployTransaction.gasPrice || 0);
    const abiEncodedConstructorArgs = contract.interface.encodeDeploy(constructorArgs);

    if (debug) {
        console.log(
            `\nDeployed ${contractName} to ${contract.address} in block ${receipt.blockNumber}, using ${
                receipt.gasUsed
            } gas costing ${formatUnits(txCost)} ETH`,
        );
        console.log(`ABI encoded args: ${abiEncodedConstructorArgs.slice(2)}`);
    }
    // Verify the contract on Etherscan if not local network
    if (hre.network.name !== "hardhat" && hre.network.name !== "localhost") {
        await hre.run("verify:verify", {
            address: contract.address,
            constructorArguments: [...constructorArgs],
        });
    }
    return contract;
};

export const logTxDetails = async (tx: ContractTransaction, method: string): Promise<ContractReceipt> => {
    console.log(
        `Sent ${method} transaction with hash ${tx.hash} from ${tx.from} with gas price ${
            tx.gasPrice?.toNumber() || 0 / 1e9
        } Gwei`,
    );
    const receipt = await tx.wait();

    // Calculate tx cost in Wei
    const txCost = receipt.gasUsed.mul(tx.gasPrice ?? 0);
    console.log(
        `Processed ${method} tx in block ${receipt.blockNumber}, using ${receipt.gasUsed} gas costing ${formatUnits(
            txCost,
        )} ETH`,
    );

    return receipt;
};

export function logExtSystem(system: ExtSystemConfig) {
    const keys = Object.keys(system);
    console.log(`\n~~~~~~~~~~~~~~~~~~~~~~~~~~~`);
    console.log(`~~~~~~~ EXT  SYSTEM ~~~~~~~`);
    console.log(`~~~~~~~~~~~~~~~~~~~~~~~~~~~\n`);
    keys.map(k => {
        console.log(`${k}:\t${system[k]}`);
    });
}

export function logContracts(contracts: { [key: string]: { address: string } }) {
    const keys = Object.keys(contracts);
    console.log(`\n~~~~~~~~~~~~~~~~~~~~~~~~~~~`);
    console.log(`~~~~ SYSTEM DEPLOYMENT ~~~~`);
    console.log(`~~~~~~~~~~~~~~~~~~~~~~~~~~~\n`);
    keys.map(k => {
        if (Array.isArray(contracts[k])) {
            console.log(`${k}:\t[${(contracts[k] as unknown as [{ address: string }]).map(i => i.address)}]`);
        } else {
            console.log(`${k}:\t${contracts[k].address}`);
        }
    });
}

export async function waitForTx(
    tx: ContractTransaction,
    debug = false,
    waitForBlocks = undefined,
): Promise<ContractReceipt> {
    const receipt = await tx.wait(waitForBlocks);
    if (debug) {
        console.log(`\nTRANSACTION: ${receipt.transactionHash}`);
        console.log(`to:: ${tx.to}`);
        console.log(`txData:: ${tx.data}`);
    }
    return receipt;
}

export const computeCreate2Address = async <F extends ContractFactory>(
    create2FactoryAddress: string,
    contractFactory: F,
    salt: string,
    constructorArgs: Array<unknown> = [],
): Promise<string> => {
    const unsignedTx = contractFactory.getDeployTransaction(...constructorArgs);

    const create2Salt = solidityKeccak256(["string"], [salt]);

    return _computeCreate2Address(create2FactoryAddress, create2Salt, unsignedTx.data);
};

function _computeCreate2Address(create2DeployerAddress: string, salt: string, bytecode: BytesLike): string {
    return getAddress(
        "0x" +
            solidityKeccak256(
                ["bytes"],
                [
                    `0xff${create2DeployerAddress.slice(2)}${salt.slice(2)}${solidityKeccak256(
                        ["bytes"],
                        [bytecode],
                    ).slice(2)}`,
                ],
            ).slice(-40),
    );
}
