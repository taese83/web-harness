import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('renders the heading', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Golden react-vite-spa' })).toBeInTheDocument();
  });

  it('shows the home route by default', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByText('Home 화면입니다.')).toBeInTheDocument();
  });
});
