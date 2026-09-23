#!/usr/bin/env node
/**
 * @module @thawgate/tui
 * @description Admin Terminal UI for managing SSS stablecoins.
 *
 * Screens:
 *  - Dashboard: Supply overview, pause status, role summary
 *  - Mint: Issue new tokens with quota display
 *  - Blacklist: View/manage blacklisted addresses
 *  - Audit: View recent actions from the audit log
 *
 * Navigation: M (Mint) | B (Blacklist) | A (Audit) | D (Dashboard) | Q (Quit)
 */

import React, { useState, useEffect } from "react";
import { render, Text, Box, useInput, useApp } from "ink";

// ============================================================================
// Types
// ============================================================================
type Screen = "dashboard" | "mint" | "blacklist" | "audit";

// ============================================================================
// Dashboard Screen
// ============================================================================
function DashboardScreen() {
    return (
        <Box flexDirection="column" padding={1}>
            <Text bold color="cyan">
                ╔══════════════════════════════════════════╗
            </Text>
            <Text bold color="cyan">
                ║          SSS Stablecoin Dashboard        ║
            </Text>
            <Text bold color="cyan">
                ╚══════════════════════════════════════════╝
            </Text>
            <Text>{""}</Text>

            <Box flexDirection="row" gap={4}>
                <Box flexDirection="column">
                    <Text color="green">● Status: Active</Text>
                    <Text color="gray">  Mint: Loading...</Text>
                    <Text color="gray">  Authority: Loading...</Text>
                </Box>
                <Box flexDirection="column">
                    <Text bold>Supply</Text>
                    <Text color="green">  Minted: 0</Text>
                    <Text color="red">  Burned: 0</Text>
                    <Text color="cyan">  Net:    0</Text>
                </Box>
            </Box>

            <Text>{""}</Text>
            <Text color="gray">
                Active Roles: MasterAuthority(1) Minter(0) Burner(0) Pauser(0)
            </Text>
        </Box>
    );
}

// ============================================================================
// Mint Screen
// ============================================================================
function MintScreen() {
    return (
        <Box flexDirection="column" padding={1}>
            <Text bold color="yellow">
                🪙 Mint Tokens
            </Text>
            <Text>{""}</Text>
            <Text color="gray">Recipient: (enter wallet address)</Text>
            <Text color="gray">Amount:    (enter amount)</Text>
            <Text>{""}</Text>
            <Text color="gray">
                Quota: 0 / 10,000,000 (Unlimited period)
            </Text>
            <Text>{""}</Text>
            <Text color="yellow">
                Press ENTER to submit, ESC to cancel
            </Text>
        </Box>
    );
}

// ============================================================================
// Blacklist Screen
// ============================================================================
function BlacklistScreen() {
    return (
        <Box flexDirection="column" padding={1}>
            <Text bold color="red">
                🚫 Blacklist Management
            </Text>
            <Text>{""}</Text>
            <Text color="gray">No blacklisted addresses.</Text>
            <Text>{""}</Text>
            <Text color="gray">
                Commands: A (Add) | R (Remove) | ESC (Back)
            </Text>
        </Box>
    );
}

// ============================================================================
// Audit Screen
// ============================================================================
function AuditScreen() {
    return (
        <Box flexDirection="column" padding={1}>
            <Text bold color="blue">
                📋 Audit Log
            </Text>
            <Text>{""}</Text>
            <Text color="gray">No audit events recorded.</Text>
            <Text>{""}</Text>
            <Text color="gray">
                Showing last 20 events. Press R to refresh.
            </Text>
        </Box>
    );
}

// ============================================================================
// Main TUI App
// ============================================================================
function App() {
    const { exit } = useApp();
    const [screen, setScreen] = useState<Screen>("dashboard");

    useInput((input, key) => {
        if (input === "q" || input === "Q") {
            exit();
        } else if (input === "d" || input === "D") {
            setScreen("dashboard");
        } else if (input === "m" || input === "M") {
            setScreen("mint");
        } else if (input === "b" || input === "B") {
            setScreen("blacklist");
        } else if (input === "a" || input === "A") {
            setScreen("audit");
        } else if (key.escape) {
            setScreen("dashboard");
        }
    });

    return (
        <Box flexDirection="column">
            {/* Screen Content */}
            {screen === "dashboard" && <DashboardScreen />}
            {screen === "mint" && <MintScreen />}
            {screen === "blacklist" && <BlacklistScreen />}
            {screen === "audit" && <AuditScreen />}

            {/* Navigation Bar */}
            <Box borderStyle="single" borderColor="gray" padding={0} marginTop={1}>
                <Text>
                    {"  "}
                    <Text color={screen === "dashboard" ? "cyan" : "gray"} bold={screen === "dashboard"}>
                        [D]ashboard
                    </Text>
                    {"  "}
                    <Text color={screen === "mint" ? "yellow" : "gray"} bold={screen === "mint"}>
                        [M]int
                    </Text>
                    {"  "}
                    <Text color={screen === "blacklist" ? "red" : "gray"} bold={screen === "blacklist"}>
                        [B]lacklist
                    </Text>
                    {"  "}
                    <Text color={screen === "audit" ? "blue" : "gray"} bold={screen === "audit"}>
                        [A]udit
                    </Text>
                    {"  "}
                    <Text color="gray">[Q]uit</Text>
                </Text>
            </Box>
        </Box>
    );
}

// ============================================================================
// Entry Point
// ============================================================================
render(<App />);
