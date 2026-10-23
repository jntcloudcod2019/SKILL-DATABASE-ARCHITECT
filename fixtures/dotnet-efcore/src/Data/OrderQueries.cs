using Dapper;
using System.Data;

public class OrderQueries
{
    public Task<IEnumerable<dynamic>> OpenByCustomer(IDbConnection db, Guid customerId) =>
        db.QueryAsync("SELECT id, status, total FROM orders WHERE customer_id = @customerId AND status = 'Received' ORDER BY created_at DESC", new { customerId });
}
