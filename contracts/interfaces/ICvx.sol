// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";

interface ICvx is IERC20 {
    function INIT_MINT_AMOUNT() external view returns (uint256);

    function minterMinted() external view returns (uint256);

    function reductionPerCliff() external view returns (uint256);

    function totalCliffs() external view returns (uint256);

    function EMISSIONS_MAX_SUPPLY() external view returns (uint256);
}
