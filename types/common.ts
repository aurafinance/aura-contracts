import { Signer } from "ethers"

export type EthAddress = string
export type Bytes32 = string
export type Nullable<T> = T | null;

export interface Account {
    signer: Signer
    address: string
}

// Booster.PoolInfo
export type PoolInfo = {
    lptoken: string;
    token: string;
    gauge: string;
    crvRewards: string;
    stash: string;
    shutdown: boolean;
};
export interface AxiosResult<T> {
    error: boolean;
    data: Array<T>;
}
