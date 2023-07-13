// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IExtraRewardStash {
    function tokenInfo(address)
        external
        view
        returns (
            address,
            address,
            address
        );
}
