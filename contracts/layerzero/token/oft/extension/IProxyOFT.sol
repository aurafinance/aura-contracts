// SPDX-License-Identifier: MIT

pragma solidity 0.8.11;

import "../IOFTCore.sol";

/**
 * @dev Interface of the ProxyOFT standard
 */
interface IProxyOFT is IOFTCore {
    function innerToken() external view returns (address);
}
