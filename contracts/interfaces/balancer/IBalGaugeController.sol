// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IBalGaugeController {
    function get_gauge_weight(address _gauge) external view returns (uint256);

    function vote_user_slopes(address, address)
        external
        view
        returns (
            uint256,
            uint256,
            uint256
        ); //slope,power,end

    function vote_for_gauge_weights(address, uint256) external;

    function add_gauge(
        address,
        int128,
        uint256
    ) external;

    function gauges(uint256) external view returns (address);

    function checkpoint_gauge(address) external;

    function n_gauges() external view returns (uint256);
}
