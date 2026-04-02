#!/bin/bash
# Quick database viewer for Nebula

echo "🔍 Nebula Database Viewer"
echo "========================="
echo ""

# Function to run query
run_query() {
    psql -U nebula_user -d nebula -c "$1"
}

# Menu
while true; do
    echo "What would you like to view?"
    echo "1. All Users"
    echo "2. Recent Credit Transactions"
    echo "3. Active Sessions"
    echo "4. Jobs"
    echo "5. Workers"
    echo "6. User Stats Summary"
    echo "7. Custom Query"
    echo "8. Exit"
    echo ""
    read -p "Enter choice (1-8): " choice

    case $choice in
        1)
            echo ""
            echo "📊 All Users:"
            run_query "SELECT id, email, name, role, credits, tasks_completed, jobs_submitted, created_at FROM users ORDER BY created_at DESC;"
            ;;
        2)
            echo ""
            echo "💰 Recent Credit Transactions:"
            run_query "SELECT ct.id, u.email, ct.type, ct.amount, ct.balance_after, ct.description, ct.created_at FROM credit_transactions ct JOIN users u ON ct.user_id = u.id ORDER BY ct.created_at DESC LIMIT 20;"
            ;;
        3)
            echo ""
            echo "🔐 Active Sessions:"
            run_query "SELECT s.id, u.email, s.created_at, s.expires_at FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.expires_at > NOW() ORDER BY s.created_at DESC;"
            ;;
        4)
            echo ""
            echo "📋 Jobs:"
            run_query "SELECT id, status, total_tasks, completed_tasks, cost_estimate, actual_cost, created_at FROM jobs ORDER BY created_at DESC LIMIT 10;"
            ;;
        5)
            echo ""
            echo "⚙️  Workers:"
            run_query "SELECT w.id, u.email, w.worker_type, w.status, w.tasks_completed, w.reputation_score, w.last_seen_at FROM workers w JOIN users u ON w.user_id = u.id ORDER BY w.last_seen_at DESC;"
            ;;
        6)
            echo ""
            echo "📈 User Stats Summary:"
            run_query "SELECT role, COUNT(*) as count, SUM(credits) as total_credits, SUM(tasks_completed) as total_tasks FROM users WHERE deleted_at IS NULL GROUP BY role;"
            ;;
        7)
            echo ""
            read -p "Enter SQL query: " query
            run_query "$query"
            ;;
        8)
            echo "Goodbye!"
            exit 0
            ;;
        *)
            echo "Invalid choice!"
            ;;
    esac
    echo ""
    echo "Press Enter to continue..."
    read
    clear
done
