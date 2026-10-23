using Microsoft.EntityFrameworkCore.Migrations;

public partial class Initial : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(name: "customers", columns: table => new { Id = table.Column<Guid>(nullable: false) });
    }
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "customers");
    }
}
