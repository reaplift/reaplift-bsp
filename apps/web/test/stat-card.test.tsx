import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatCard } from '../src/components/StatCard';

// Proves the component test setup works: render into jsdom and find text as a user would.
describe('StatCard', () => {
  it('shows its label, value and trend', () => {
    render(<StatCard label="Delivered" value="1,234" trend="+4% this week" />);
    expect(screen.getByText('Delivered')).toBeDefined();
    expect(screen.getByText('1,234')).toBeDefined();
    expect(screen.getByText('+4% this week')).toBeDefined();
  });
});
