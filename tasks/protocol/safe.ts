import * as fs from "fs";
import * as path from "path";

export type SafeTxCreation = {
    chainId?: string;
    name?: string;
    description?: string;
    createdFromSafeAddress?: string;
};
export type SafeTxFile = {
    version: string;
    chainId: string;
    createdAt: number;
    meta: {
        name: string;
        description: string;
        txBuilderVersion: string;
        createdFromSafeAddress: string;
        createdFromOwnerAddress: string;
        checksum: string;
    };
    transactions: any[];
};
/* ---------------------------------------------------------------
     * Tx Builder  
    --------------------------------------------------------------- */

export const buildSafeTx =
    (params: SafeTxCreation) =>
    (transactions: Array<any>): SafeTxFile => ({
        version: "1.0",
        chainId: params.chainId ?? "1",
        createdAt: Date.now(),
        meta: {
            name: params.name ?? "Transactions Batch",
            description: params.description ?? "",
            txBuilderVersion: "1.16.2",
            createdFromSafeAddress: params.createdFromSafeAddress,
            createdFromOwnerAddress: "",
            checksum: "",
        },
        transactions,
    });

export function writeSafeTxFile(safeTx: SafeTxFile, fileName: string) {
    if (safeTx.transactions.length > 0) {
        const filePath = path.resolve(__dirname, `./${fileName}.json`);
        console.log("File generated", filePath);
        fs.writeFileSync(filePath, JSON.stringify(safeTx, null, 4));
    }
}
export const poolManagerAddPoolTx = (poolManager: string, gauge: string) => ({
    to: poolManager,
    value: "0",
    data: null,
    contractMethod: {
        inputs: [
            {
                name: "_gauge",
                type: "address",
                internalType: "address",
            },
        ],
        name: "addPool",
        payable: false,
    },
    contractInputsValues: {
        _gauge: gauge,
    },
});
export const poolManagerOwnerAddPoolTx = (poolManager: string, gauge: string) => ({
    to: poolManager,
    value: "0",
    data: null,
    contractMethod: {
        inputs: [
            {
                name: "_gauge",
                type: "address",
                internalType: "address",
            },
        ],
        name: "ownerAddPool",
        payable: false,
    },
    contractInputsValues: {
        _gauge: gauge,
    },
});

export const boosterOwnerSecondaryTxsBuilder = (boosterOwnerSecondary: string) => {
    const setStashExtraReward = (pid: number, token: string) => ({
        to: boosterOwnerSecondary,
        value: "0",
        data: null,
        contractMethod: {
            inputs: [
                { name: "_pid", type: "uint256", internalType: "uint256" },
                { name: "_token", type: "address", internalType: "address" },
            ],
            name: "setStashExtraReward",
            payable: false,
        },
        contractInputsValues: {
            _pid: `${pid}`,
            _token: token,
        },
    });
    return { setStashExtraReward };
};
export const boosterOwnerLiteTxsBuilder = (boosterOwner: string) => {
    const setStashExtraReward = (stash: string, token: string) => ({
        to: boosterOwner,
        value: "0",
        data: null,
        contractMethod: {
            inputs: [
                { name: "_stash", type: "address", internalType: "address" },
                { name: "_token", type: "address", internalType: "address" },
            ],
            name: "setStashExtraReward",
            payable: false,
        },
        contractInputsValues: {
            _stash: stash,
            _token: token,
        },
    });
    return { setStashExtraReward };
};
export const gaugeVoterTxsBuilder = (gaugeVoteRewards: string) => {
    const setPoolIds = (start: number, end: number) => ({
        to: gaugeVoteRewards,
        value: "0",
        data: null,
        contractMethod: {
            inputs: [
                { name: "start", type: "uint256", internalType: "uint256" },
                { name: "end", type: "uint256", internalType: "uint256" },
            ],
            name: "setPoolIds",
            payable: false,
        },
        contractInputsValues: {
            start: `${start}`,
            end: `${end}`,
        },
    });

    const setIsNoDepositGauge = (gauge: string, isNoDeposit = true) => ({
        to: gaugeVoteRewards,
        value: "0",
        data: null,
        contractMethod: {
            inputs: [
                {
                    name: "_gauge",
                    type: "address",
                    internalType: "address",
                },
                {
                    name: "_isNoDeposit",
                    type: "bool",
                    internalType: "bool",
                },
            ],
            name: "setIsNoDepositGauge",
            payable: false,
        },
        contractInputsValues: {
            _gauge: gauge,
            _isNoDeposit: `${isNoDeposit}`,
        },
    });

    const setDstChainId = (gauges: string[], dstChainId: number) => ({
        to: gaugeVoteRewards,
        value: "0",
        data: null,
        contractMethod: {
            inputs: [
                {
                    name: "_gauges",
                    type: "address[]",
                    internalType: "address[]",
                },
                {
                    name: "_dstChainId",
                    type: "uint16",
                    internalType: "uint16",
                },
            ],
            name: "setDstChainId",
            payable: false,
        },
        contractInputsValues: {
            _gauges: `[${gauges}]`,
            _dstChainId: `${dstChainId}`,
        },
    });
    return {
        setPoolIds,
        setIsNoDepositGauge,
        setDstChainId,
    };
};
export const poolFeeManagerProxyTxsBuilder = (poolManager: string) => {
    const addPool = (gauge: string) => ({
        to: poolManager,
        value: "0",
        data: null,
        contractMethod: {
            inputs: [
                {
                    name: "_gauge",
                    type: "address",
                    internalType: "address",
                },
            ],
            name: "addPool",
            payable: false,
        },
        contractInputsValues: {
            _gauge: gauge,
        },
    });
    return { addPool };
};
export const l2PoolManagerProxyTxsBuilder = (poolManager: string) => {
    const ownerAddPool = (gauge: string) => ({
        to: poolManager,
        value: "0",
        data: null,
        contractMethod: {
            inputs: [
                {
                    name: "_gauge",
                    type: "address",
                    internalType: "address",
                },
            ],
            name: "ownerAddPool",
            payable: false,
        },
        contractInputsValues: {
            _gauge: gauge,
        },
    });
    return { ownerAddPool };
};

export const extraRewardStashModuleTxsBuilder = (extraRewardStashModule: string) => {
    const setStashExtraReward = (pid: number, token: string) => ({
        to: extraRewardStashModule,
        value: "0",
        data: null,
        contractMethod: {
            inputs: [
                { name: "_pid", type: "uint256", internalType: "uint256" },
                { name: "_token", type: "address", internalType: "address" },
            ],
            name: "setStashExtraReward",
            payable: false,
        },
        contractInputsValues: {
            _pid: `${pid}`,
            _token: token,
        },
    });
    return { setStashExtraReward };
};
