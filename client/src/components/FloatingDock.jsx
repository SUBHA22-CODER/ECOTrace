import React from 'react';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  Bot,
  FileCheck,
  Radio,
  Bell,
  Activity,
  Settings,
} from 'lucide-react';

const DOCK_ITEMS = [
  { id: 'overview',       icon: LayoutDashboard, label: 'Overview' },
  { id: 'agents',         icon: Bot,             label: 'Agents' },
  { id: 'contracts',      icon: FileCheck,       label: 'Rules' },
  { id: 'calls',          icon: Radio,           label: 'Calls' },
  { id: 'alerts',         icon: Bell,            label: 'Alerts' },
  { id: 'observability',  icon: Activity,        label: 'Health' },
  { id: 'settings',       icon: Settings,        label: 'Settings' },
];

/**
 * FloatingDock — A macOS-style floating dock navigation bar
 * pinned to the bottom-center of the viewport.
 */
export default function FloatingDock({ activeTab, setActiveTab }) {
  return (
    <motion.nav
      className="floating-dock"
      initial={{ y: 80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 24, delay: 0.3 }}
    >
      <div className="floating-dock__track">
        {DOCK_ITEMS.map((item, idx) => {
          const isActive = activeTab === item.id;
          const Icon = item.icon;

          return (
            <React.Fragment key={item.id}>
              {/* Separator between "primary" and "utility" groups */}
              {idx === 2 && <span className="floating-dock__sep" />}
              <motion.button
                className={`floating-dock__btn${isActive ? ' floating-dock__btn--active' : ''}`}
                onClick={() => setActiveTab(item.id)}
                whileHover={{ scale: 1.18, y: -4 }}
                whileTap={{ scale: 0.92 }}
                transition={{ type: 'spring', stiffness: 400, damping: 17 }}
                title={item.label}
                aria-label={item.label}
              >
                <Icon
                  size={20}
                  strokeWidth={isActive ? 2.2 : 1.6}
                />
                {isActive && (
                  <motion.span
                    className="floating-dock__dot"
                    layoutId="dock-indicator"
                    transition={{ type: 'spring', stiffness: 380, damping: 22 }}
                  />
                )}
              </motion.button>
            </React.Fragment>
          );
        })}
      </div>
    </motion.nav>
  );
}
