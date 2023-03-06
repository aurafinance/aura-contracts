// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;
import { AuraMath } from "../utils/AuraMath.sol";

// Forked of https://etherscan.io/address/0x3c75bfe6fbfda3a94e7e7e8c2216afc684de5343#code
//  - Refactor based on Aura emissions schedule.

// solhint-disable func-name-mixedcase
interface ICvx {
    function reductionPerCliff() external view returns (uint256);

    function totalSupply() external view returns (uint256);

    function totalCliffs() external view returns (uint256);

    function INIT_MINT_AMOUNT() external view returns (uint256);

    function EMISSIONS_MAX_SUPPLY() external view returns (uint256);
}

/**
 * @notice Utility library to calculate how many Cvx will be minted based on the amount of Crv.
 * Do not use this on-chain, as AuraMinter after can mint additional tokens after `inflationProtectionTime`
 * has passed, those new tokens are not taken into consideration in this library.
 */
library AuraMining {
    ICvx public constant cvx = ICvx(0xC0c293ce456fF0ED870ADd98a0828Dd4d2903DBF);
    using AuraMath for uint256;

    /**
     * @dev Calculates the amount of AURA to mint based on the BAL supply schedule.
     * Do not use this on chain.
     */
    function convertCrvToCvx(uint256 _amount) external view returns (uint256 amount) {
        uint256 supply = cvx.totalSupply();
        uint256 totalCliffs = cvx.totalCliffs();
        uint256 maxSupply = cvx.EMISSIONS_MAX_SUPPLY();
        uint256 initMintAmount = cvx.INIT_MINT_AMOUNT();

        // After AuraMinter.inflationProtectionTime has passed, this calculation might not be valid.
        // uint256 emissionsMinted = supply - initMintAmount - minterMinted;
        uint256 emissionsMinted = supply - initMintAmount;

        uint256 cliff = emissionsMinted.div(cvx.reductionPerCliff());

        // e.g. 100 < 500
        if (cliff < totalCliffs) {
            // e.g. (new) reduction = (500 - 100) * 2.5 + 700 = 1700;
            // e.g. (new) reduction = (500 - 250) * 2.5 + 700 = 1325;
            // e.g. (new) reduction = (500 - 400) * 2.5 + 700 = 950;
            uint256 reduction = totalCliffs.sub(cliff).mul(5).div(2).add(700);
            // e.g. (new) amount = 1e19 * 1700 / 500 =  34e18;
            // e.g. (new) amount = 1e19 * 1325 / 500 =  26.5e18;
            // e.g. (new) amount = 1e19 * 950 / 500  =  19e17;
            amount = _amount.mul(reduction).div(totalCliffs);
            // e.g. amtTillMax = 5e25 - 1e25 = 4e25
            uint256 amtTillMax = maxSupply.sub(emissionsMinted);
            if (amount > amtTillMax) {
                amount = amtTillMax;
            }
        }
    }
}
