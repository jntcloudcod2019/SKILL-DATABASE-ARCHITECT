using Microsoft.EntityFrameworkCore;
using Shop.Domain;

namespace Shop.Data;

public class ShopContext : DbContext
{
    public ShopContext(DbContextOptions<ShopContext> options) : base(options) { }

    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<OrderItem> OrderItems => Set<OrderItem>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Order>(e =>
        {
            e.ToTable("orders");
            e.HasKey(x => x.Id);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Total).HasPrecision(18, 2);
            e.Property(x => x.ExternalId).HasMaxLength(64);
            e.HasIndex(x => x.ExternalId).IsUnique();
            e.HasOne(x => x.Customer).WithMany(c => c.Orders).HasForeignKey(x => x.CustomerId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<OrderItem>(e =>
        {
            e.ToTable("order_items");
            e.Property(x => x.UnitPrice).HasPrecision(18, 2);
            e.Property(x => x.Description).HasMaxLength(200);
            e.HasOne(x => x.Order).WithMany(o => o.Items).HasForeignKey(x => x.OrderId).OnDelete(DeleteBehavior.Cascade);
        });
    }
}
