using Microsoft.EntityFrameworkCore;
using Hub.Domain.Merchants;
using Hub.Domain.Orders;

namespace Hub.Data;

public class HubContext : DbContext
{
    public HubContext(DbContextOptions<HubContext> options) : base(options) { }
    public DbSet<Pedido> Pedidos => Set<Pedido>();
    public DbSet<Merchant> Merchants => Set<Merchant>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Pedido>(e =>
        {
            e.ToTable("pedidos");
            e.Property(x => x.ValorTotal).HasPrecision(18, 2);
            e.OwnsOne(x => x.Cliente);
            e.OwnsOne(x => x.Endereco, b =>
            {
                b.Property(x => x.Rua).HasColumnName("endereco_rua");
                b.OwnsOne(x => x.Local);
            });
            e.OwnsOne(x => x.Pagamento, b => b.ToJson("pagamento_json"));
            e.Property(x => x.ReceiptData).HasColumnType("jsonb");
            e.OwnsMany(x => x.Itens, b =>
            {
                b.ToTable("pedido_itens");
                b.WithOwner().HasForeignKey("PedidoId");
                b.Property(x => x.PrecoUnitario).HasPrecision(18, 2);
            });
        });
    }
}
